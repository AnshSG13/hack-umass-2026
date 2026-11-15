"use client";

// The stand page: open it on a laptop or tablet at the table. Visitors scan the code with an
// iPhone camera, make an account, and land on /setup, where the ready-made Shortcut is one tap
// (QUICK_SHORTCUT_URL). Sign up sends new accounts through the intro and then to /setup.

import { useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useConfig } from "@/lib/hooks";
import { pageTitle } from "@/lib/styles";

const noopSubscribe = () => () => {};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="wide tabular w-8 shrink-0 text-[28px] leading-[1.2] text-ink">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[20px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[16px] text-muted">{children}</p>
      </div>
    </li>
  );
}

export default function StandPage() {
  const { config, appName } = useConfig();
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  // The configured address wins, so a laptop that opened the stand page on another name
  // still hands out the real one.
  const base = (config?.public_base_url || origin).replace(/\/$/, "");
  const target = base ? `${base}/signup` : "";
  const host = base.replace(/^https?:\/\//, "");
  const quickUrl = config?.quick_shortcut_url || "";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col justify-center px-4 py-10">
      <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex flex-col items-center text-center" aria-label="Scan to start">
          <div className="w-full max-w-[460px] rounded-[24px] border border-line bg-white p-5">
            {target ? (
              <QRCodeSVG
                value={target}
                size={420}
                fgColor="#1B2430"
                bgColor="#FFFFFF"
                level="M"
                marginSize={1}
                style={{ width: "100%", height: "auto" }}
                title={`QR code that opens ${appName} sign up`}
              />
            ) : (
              <span aria-hidden="true" className="block aspect-square w-full bg-paper" />
            )}
          </div>
          <p className="mt-4 text-[20px] text-ink">Scan with your iPhone camera</p>
          {host && <p className="mt-1 text-[16px] break-all text-muted">or open {host} in Safari</p>}
        </section>

        <section aria-labelledby="stand-title">
          <h1 id="stand-title" className={pageTitle}>
            {appName}
          </h1>
          <p className="mt-2 text-[20px] text-ink">Every save becomes a plan.</p>
          <ol className="mt-8 flex flex-col gap-6">
            <Step n={1} title="Make an account">
              An email and a password, right after you scan.
            </Step>
            <Step n={2} title="Add the Shortcut">
              {quickUrl ? "One tap on the next screen. There is nothing to type." : "The setup screen shows you how."}
            </Step>
            <Step n={3} title={`Share a reel to ${appName}`}>
              In Instagram, tap Share on any reel, then {appName}. Your plan shows up in the app.
            </Step>
          </ol>
          <p className="mt-8 text-[14px] text-muted">Use Safari on iPhone, so the Shortcut and the app share your sign in.</p>
        </section>
      </div>
    </main>
  );
}
