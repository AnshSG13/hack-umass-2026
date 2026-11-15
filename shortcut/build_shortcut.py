"""Write the key-saving Realize Shortcut as an unsigned .shortcut file.

iOS only imports signed Shortcut files, and only a Mac can sign one, so this file is the
input to `shortcuts sign` on a Mac (shortcut/README.md, "Build the key-saving Shortcut on
a Mac"). It runs anywhere with Python 3 and needs no packages.

What the Shortcut does when a reel is shared to it:
  1. Input that is a key (rl_...) is a hand-over from /connect: save it to
     realize-key.txt in the Shortcuts folder, say "Connected" and stop.
  2. No saved key yet: take it from the clipboard (/setup's "Add the Shortcut" copied it).
     If the clipboard holds no key, open BASE/connect?url=<reel> and stop.
  3. POST the reel to BASE/api/save with "Authorization: Bearer <key>".
  4. key_ok "no" means the key stopped working: open BASE/connect?url=<reel>.
     Otherwise show the server's message as a notification.

Usage:
  python shortcut/build_shortcut.py --base https://reelize.boston
  (or leave out --base to use PUBLIC_BASE_URL from the environment or .env)
"""
from __future__ import annotations

import argparse
import os
import plistlib
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = "realize-key.txt"
KEY_PREFIX = "rl_"
OBJ = "￼"  # where a variable sits inside a text field

# Shortcuts' condition codes for the If action.
IS, BEGINS_WITH, HAS_NO_VALUE = 4, 8, 101


def base_url(arg: str | None) -> str:
    value = arg or os.environ.get("PUBLIC_BASE_URL", "")
    env = ROOT / ".env"
    if not value and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("PUBLIC_BASE_URL="):
                value = line.split("=", 1)[1].strip().strip('"')
    if not value.startswith("https://"):
        sys.exit("Give the site's https address: --base https://your.domain")
    return value.rstrip("/")


def new_id() -> str:
    return str(uuid.uuid4()).upper()


def output(action_id: str, name: str) -> dict:
    return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": name}


SHORTCUT_INPUT = {"Type": "ExtensionInput"}


def attachment(var: dict) -> dict:
    """A whole-field variable, for an action's input."""
    return {"Value": var, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts: str | dict) -> dict:
    """A text field: plain strings with variables in between."""
    string, attachments = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            attachments[f"{{{len(string)}, 1}}"] = part
            string += OBJ
    return {"Value": {"string": string, "attachmentsByRange": attachments},
            "WFSerializationType": "WFTextTokenString"}


def action(identifier: str, params: dict | None = None, uid: str | None = None) -> dict:
    p = dict(params or {})
    if uid:
        p["UUID"] = uid
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": p}


def if_start(group: str, var: dict, condition: int, value: str | None = None) -> dict:
    p = {"GroupingIdentifier": group, "WFControlFlowMode": 0, "WFCondition": condition,
         "WFInput": {"Type": "Variable", "Variable": attachment(var)}}
    if value is not None:
        p["WFConditionalActionString"] = value
    return action("conditional", p)


def if_else(group: str) -> dict:
    return action("conditional", {"GroupingIdentifier": group, "WFControlFlowMode": 1})


def if_end(group: str) -> dict:
    return action("conditional", {"GroupingIdentifier": group, "WFControlFlowMode": 2}, new_id())


def save_key(var: dict) -> dict:
    return action("documentpicker.save", {"WFInput": attachment(var), "WFAskWhereToSave": False,
                                          "WFFileDestinationPath": KEY_FILE, "WFSaveFileOverwrite": True}, new_id())


def get_key_file(uid: str) -> dict:
    return action("documentpicker.open", {"WFGetFilePath": KEY_FILE, "WFFileErrorIfNotFound": False,
                                          "WFShowFilePicker": False}, uid)


def open_connect(base: str) -> list[dict]:
    enc = new_id()
    return [
        action("urlencode", {"WFInput": text(SHORTCUT_INPUT), "WFEncodeMode": "Encode"}, enc),
        action("openurl", {"WFInput": text(f"{base}/connect?url=", output(enc, "URL Encoded Text"))}, new_id()),
    ]


def field(key: str, value: dict, item_type: int = 0) -> dict:
    return {"WFItemType": item_type, "WFKey": text(key), "WFValue": value}


def dictionary(*items: dict) -> dict:
    return {"Value": {"WFDictionaryFieldValueItems": list(items)}, "WFSerializationType": "WFDictionaryFieldValue"}


def build(base: str) -> dict:
    t_input, f_first, clip, f_key, key_text, resp, ok, msg = (new_id() for _ in range(8))
    g_handover, g_nokey, g_clip, g_bad = (new_id() for _ in range(4))
    actions = [
        # 1. A key handed over by /connect.
        action("gettext", {"WFTextActionText": text(SHORTCUT_INPUT)}, t_input),
        if_start(g_handover, output(t_input, "Text"), BEGINS_WITH, KEY_PREFIX),
        save_key(output(t_input, "Text")),
        action("notification", {"WFNotificationActionBody": "Connected. Share reels from Instagram to save them.",
                                "WFNotificationActionSound": False}, new_id()),
        action("exit"),
        if_else(g_handover),
        if_end(g_handover),
        # 2. First run: the key from the clipboard, else /connect.
        get_key_file(f_first),
        if_start(g_nokey, output(f_first, "File"), HAS_NO_VALUE),
        action("getclipboard", {}, clip),
        if_start(g_clip, output(clip, "Clipboard"), BEGINS_WITH, KEY_PREFIX),
        save_key(output(clip, "Clipboard")),
        if_else(g_clip),
        *open_connect(base),
        action("exit"),
        if_end(g_clip),
        if_else(g_nokey),
        if_end(g_nokey),
        # 3. Send the reel.
        get_key_file(f_key),
        action("detect.text", {"WFInput": attachment(output(f_key, "File"))}, key_text),
        action("downloadurl", {
            "WFURL": f"{base}/api/save",
            "WFHTTPMethod": "POST",
            "ShowHeaders": True,
            "WFHTTPHeaders": dictionary(field("Authorization", text("Bearer ", output(key_text, "Text")))),
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": dictionary(
                field("input", text(SHORTCUT_INPUT)),
                field("source", text("shortcut")),
                field("wait", text("0"), item_type=3),
            ),
        }, resp),
        # 4. A stale key goes to /connect; anything else shows the server's message.
        action("getvalueforkey", {"WFInput": attachment(output(resp, "Contents of URL")),
                                  "WFDictionaryKey": "key_ok", "WFGetDictionaryValueType": "Value"}, ok),
        if_start(g_bad, output(ok, "Dictionary Value"), IS, "no"),
        *open_connect(base),
        if_else(g_bad),
        action("getvalueforkey", {"WFInput": attachment(output(resp, "Contents of URL")),
                                  "WFDictionaryKey": "message", "WFGetDictionaryValueType": "Value"}, msg),
        action("notification", {"WFNotificationActionBody": text(output(msg, "Dictionary Value")),
                                "WFNotificationActionSound": False}, new_id()),
        if_end(g_bad),
    ]
    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem"],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="the site's https address, for example https://reelize.boston")
    ap.add_argument("--out", default=str(ROOT / "shortcut" / "Realize.shortcut"),
                    help="where to write the unsigned file (its name becomes the Shortcut's name)")
    args = ap.parse_args()
    base = base_url(args.base)
    out = Path(args.out)
    data = build(base)
    out.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY))
    plistlib.loads(out.read_bytes())  # fails loudly if the file isn't a readable plist
    print(f"Wrote {out} ({len(data['WFWorkflowActions'])} actions, site {base}). Sign it on a Mac next.")


if __name__ == "__main__":
    main()
