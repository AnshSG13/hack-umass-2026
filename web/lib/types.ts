// Mirrors the server's shapes (SPEC.md sections 6, 7, 12, 13.3, 15).
// The server side lives in server/realize/tickets.py and actions.py.

export type SaveType = "recipe" | "event" | "place" | "workout" | "product" | "tip" | "other";
export type Processing = "queued" | "reading" | "planning" | "planned" | "enriching" | "ready" | "failed";
export type PlanStatus = "proposed" | "accepted" | "declined" | "done" | "skipped";

export interface TicketOption {
  id: string;
  label: string; // Shortcut menu label, e.g. "Cook Thu 6:30 pm + 3 groceries"
  web_label: string; // primary button, e.g. "Add to Thursday"
  big_time: string; // "Thu 6:30 pm"
  secondary: string; // "+3 groceries"
  action: "event" | "reminder";
  start_local: string; // "YYYY-MM-DDTHH:mm" in the user's timezone
}

export interface TicketExtra {
  id: "later" | "none";
  label: string; // "Not now" | "Just vibes" | "Just save"
}

export interface TicketPlan {
  status: PlanStatus;
  intent: null | "later";
  kind: SaveType;
  actionable: boolean;
  question: string;
  why: string;
  confidence: "sure" | "best_guess";
  options: TicketOption[];
  extras: TicketExtra[];
  chosen: TicketOption | null;
  big_time: string | null;
  long_day: string | null; // "Thursday", "today", "Nov 26" for accepted plans
  scheduled_iso: string | null;
  followup_due: boolean;
  confirmed_via: "web" | "shortcut" | null;
  gcal_url: string | null;
  ics_url: string | null;
  reminders_preview: string[]; // "Groceries, Thu 12 pm"
  share_url: string; // "/p/<plan_id>?t=<token>"
  done_day: string | null; // "Thu" once done or skipped
}

export interface StepLine {
  label: string;
  state: "done" | "current" | "failed";
  ms: number | null;
}

export interface Ticket {
  save_id: string;
  plan_id: string | null;
  url: string;
  title: string | null;
  type: SaveType | null;
  subcategory: string | null; // "Dessert": groups the save inside its type
  creator: string | null; // "@chefjohn"
  thumb_url: string | null; // "/api/t/<id>"
  saved_on: string; // "Oct 3"
  created_at: string; // ISO
  processing: Processing;
  failure_reason: null | "private" | "unavailable" | "not_video" | "blocked" | "processing_error";
  failure_message: string | null;
  is_sample: boolean;
  plan: TicketPlan | null;
  steps?: StepLine[]; // detail and poll responses only
  snippet?: string; // search results only
}

// ---- POST /api/save ----
export interface SaveResponse {
  status: "proposed" | "pending" | "duplicate" | "failed" | "error";
  ask: "yes" | "no";
  save_id: string;
  prompt: string;
  menu: string[];
  message: string;
  ticket: Ticket | null;
}

// ---- POST /api/saves/{id}/confirm ----
export interface ConfirmResponse {
  status: "accepted" | "later" | "declined" | "error";
  plan_id: string;
  message: string; // toast text, e.g. "Added to Thursday."
  has_event: "yes" | "no";
  gcal_url: string;
  ics_url: string;
  ticket: Ticket | null;
}

// ---- GET /api/saves/{id} ----
export interface Ingredient { qty?: number; unit?: string; item: string; aisle?: string }
export interface Fields {
  recipe?: { servings?: number; total_time_min?: number; ingredients?: Ingredient[]; steps?: string[]; tips?: string[] };
  event?: { name?: string; start_local?: string; end_local?: string; date_text?: string; venue?: string; city?: string; ticket_url?: string; price_hint?: string };
  place?: { places?: { name: string; kind?: string; city?: string; why?: string; tip?: string }[] };
  workout?: { goal?: string; duration_min?: number; equipment?: string[]; exercises?: { name: string; sets?: number; reps?: string; duration_sec?: number; rest_sec?: number; cues?: string[] }[] };
  product?: { items?: { name: string; brand?: string; price_hint?: string; why?: string; where_to_buy?: string; url?: string }[] };
  tip?: { topic?: string; key_points?: string[]; takeaway?: string };
}

export interface RunStep {
  key: string;
  label: string;
  tool: string;
  args: unknown;
  result: unknown;
  ms: number | null;
  error?: string | null;
  ts: string | null;
  state: "done" | "current" | "failed";
}

export interface AgentRun {
  id: string;
  kind: "propose" | "enrich" | "replan" | "ask";
  model: string;
  status: "running" | "done" | "failed" | "fallback";
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  steps: RunStep[];
}

export interface SaveDetail {
  ticket: Ticket;
  details: {
    caption: string;
    summary: string;
    fields: Fields;
    transcript: { start_sec: number; text: string }[];
    on_screen_text: string[];
    entities: { name: string; kind: string }[];
    unverified: string[];
    enrich_error: string | null;
    visual_summary: string;
    language: string | null;
    duration_sec: number | null;
    note: string; // the person's own note, "" when none
  };
  runs: AgentRun[];
}

// ---- PATCH /api/saves/{id} (answers with the same shape as GET) ----
export interface SavePatch {
  type?: SaveType;
  subcategory?: string; // "" removes it
  note?: string;
}

// ---- GET, POST, PATCH /api/saves/{id}/trip and POST .../trip/days/{index} ----
// Every label, time, date and link here is made by the server; the page shows them as sent.
export interface TripSource { n: number; title: string; url: string }
export interface TripWeather { text: string; wet: boolean; high: number; low: number; unit: "F" | "C"; rain_chance: number | null }
export interface TripStop {
  name: string; from_reel: boolean; kind: string;
  part: string; // "Morning" | "Midday" | "Afternoon" | "Evening"
  time: string; // "10 am", a suggested start
  time_source: TripSource | null; // set when the time is a real start the search found, not a suggestion
  area: string; what: string;
  cost: string; cost_source: TripSource | null;
  hours: string; hours_source: TripSource | null;
  booking: "none" | "recommended" | "required" | "unknown"; booking_source: TripSource | null;
  source: TripSource | null; // for a stop that is not from the reel: where it came from
  maps_url: string; gcal_url: string | null; next_directions_url: string | null;
}
export interface TripSourced { text: string; source: TripSource | null }
export interface TripDayDetail {
  stops: { name: string; book: string; book_source: TripSource | null; highlights: TripSourced[] }[];
  eat: { name: string; why: string; near: string; source: TripSource | null; maps_url: string }[];
  rain: TripSourced | null; around: TripSourced | null;
}
export interface TripDay {
  index: number; date: string; label: string; // "Saturday, Nov 21"
  title: string; weather: TripWeather | null; stops: TripStop[];
  detail_status: "none" | "building" | "ready" | "failed"; detail_error: string | null; detail: TripDayDetail | null;
  ics_url: string; // a calendar file for the whole day
}
export interface Trip {
  id: string; city: string; start_date: string; date_label: string;
  date_options: { start_date: string; label: string }[]; dates_fixed: boolean;
  days: TripDay[];
  stay: { area: string; why: string; source: TripSource | null; maps_url: string } | null;
  heads_up: TripSourced[];
  weather_note: string | null; // e.g. "The forecast opens on Nov 27."
  weather_source: { title: string; url: string } | null;
  times_note: string; sources: TripSource[];
}
export interface TripState {
  status: "none" | "building" | "ready" | "failed"; can_build: boolean; error: string | null;
  steps: StepLine[]; trip: Trip | null;
}

// ---- GET /api/tastes ----
export interface Taste {
  type: SaveType;
  label: string; // "Food", "Fitness"
  count: number;
  thumbs: string[]; // up to 3 "/api/t/<id>"
  tags: { tag: string; count: number }[]; // up to 3
  subcategories: { name: string; count: number }[]; // every one for this type, largest first
}
export interface TastesResponse {
  total: number;
  tastes: Taste[]; // only types with at least one save, largest first
}

// ---- GET /api/saves, /api/search, /api/plans ----
export interface SavesPage { items: Ticket[]; next_before: string | null }
export interface SearchResult { items: Ticket[]; mode: string }
export interface PlansResponse {
  waiting: Ticket[];
  days: { label: string; date: string; items: Ticket[] }[]; // label "Thursday, Nov 19"
  done: Ticket[];
  later_count: number;
  week_label: string; // "Nov 16 to Nov 22"
}

// ---- GET /api/me, /api/config, /api/health ----
export interface Prefs {
  cook_days: string[]; // "mon".."sun"
  cook_time: string; // "18:30"
  workout_days: string[];
  workout_time: string;
  weekend_time: string;
  daily_cap: number; // 1..5
  quiet_start: string;
  quiet_end: string;
  types_on: Record<"recipe" | "event" | "place" | "workout" | "product" | "tip", boolean>;
}

export interface Me {
  user_id: string;
  name: string; // "" when unset
  is_demo: boolean;
  is_judge: boolean;
  email: string | null;
  timezone: string;
  prefs: Prefs;
  key_preview: string;
  expires_at: string | null;
  counts: { saves: number; by_type: Record<SaveType, number>; plans: Partial<Record<PlanStatus, number>> };
  profile: Profile | null;
  onboarded: boolean; // false: a real account that hasn't done the intro yet
}

// ---- the intro (/welcome) ----
export interface Profile {
  identity: string | null;
  age_range: string | null;
  ethnicity: string[];
  interests: string[];
  hobbies: string[];
  starters?: Partial<Record<SaveType, string[]>>;
}

export interface OnboardingOptions {
  identities: string[];
  age_ranges: string[];
  ethnicities: string[];
  interests: string[];
  hobbies: string[];
}

/** Starter sub-categories Gemini made inside one type at the end of the intro. */
export interface StarterGroup {
  type: Exclude<SaveType, "other">;
  label: string;
  subcategories: string[];
}

export interface AppConfig {
  app_name: string;
  public_base_url: string;
  shortcut_url: string;
  judge_shortcut_url: string;
  first_save_reel_url: string;
  demo_enabled: boolean;
}

export interface Health {
  ok: boolean;
  db: string;
  worker_last_seen_s: number | null;
  hybrid_mode: string;
  planner_mode: string;
  models: { fast: string; video: string; embed: string };
}

// ---- demo ----
export interface SampleCard {
  shortcode: string;
  url: string;
  title: string | null;
  creator: string | null;
  caption_excerpt: string;
  thumb_url: string | null;
  type: SaveType | null;
  saved: boolean;
}

// ---- POST /api/chat (NDJSON stream, one object per line) ----
export interface AskCard {
  save_id: string;
  title: string;
  type: SaveType | null;
  thumb_url: string | null;
  saved_on: string;
  snippet: string;
  url: string;
  /** Set when the snippet is a line spoken in the video: the tile opens the reel there. */
  at_sec?: number;
  at_label?: string; // "0:11"
}

export type ChatEvent =
  | { type: "step"; label: string }
  | { type: "cards"; cards: AskCard[] }
  | { type: "plans"; tickets: Ticket[] }
  | { type: "answer"; text: string; confidence: "high" | "low" | "none"; save_ids: string[]; follow_ups?: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

// ---- discussions: chats about one reel, saved with it ----
export interface DiscussionMessage {
  role: "user" | "assistant";
  text: string;
  at: string | null;
  /** The transcript line the answer leans on, checked by the server. Assistant only. */
  at_sec?: number | null;
  at_label?: string | null; // "0:11"
  /** false: general knowledge, not something the reel says. Assistant only. */
  from_reel?: boolean;
}
export interface DiscussionSummary {
  id: string;
  title: string; // the first question
  questions: number;
  updated_at: string;
  preview: string;
}
export interface Discussion extends DiscussionSummary {
  save_id: string;
  messages: DiscussionMessage[];
}

// ---- GET /api/tastes/{type}: one taste as a board ----
export interface BoardItem {
  save_id: string;
  title: string;
  thumb_url: string | null;
  meta: string; // "20 min · 7 ingredients", or "" when the reel gave nothing to say
  tags: string[];
  has_note: boolean;
  is_new: boolean; // saved in the last day
}
export interface Board {
  type: SaveType;
  label: string;
  count: number;
  tags: { tag: string; count: number }[]; // the filter chips, at most 6
  items: BoardItem[];
}

// ---- bundles: "Ready for you", plans built from several saves ----
export interface BundleItem {
  save_id: string;
  title: string;
  thumb_url: string | null;
  meta: string;
  note: string; // why it sits where it does; "" until the words arrive
  when: string | null; // "Mon 6:30 pm": the time Start would pick, or the accepted time
  plan_status: PlanStatus | null;
}
export interface GroceryGroup {
  aisle: string;
  items: { key: string; text: string; from: string[] }[]; // from: the save_ids that need it
}
export interface BundleProduct {
  save_id: string;
  name: string;
  brand: string;
  price_hint: string;
  why: string;
  where_to_buy: string;
}
export interface Bundle {
  id: string;
  type: SaveType;
  status: "ready" | "started" | "dismissed";
  title: string;
  blurb: string;
  count_label: string; // "3 dinners"
  items: BundleItem[];
  thumbs: string[];
  polishing: boolean; // the name and notes are still being written
  cta: string; // "Start Monday", "Compare them", "Open"
  can_start: boolean;
  first_when: string | null;
  // GET /api/bundles/{id} only:
  groceries?: GroceryGroup[];
  grocery_count?: number;
  products?: BundleProduct[];
  pick?: { save_id: string; name: string; why: string } | null;
}
export interface BundlesResponse {
  ready: Bundle[];
  started: Bundle[];
}

// ---- GET /api/graph: the knowledge graph ----
export type GraphNodeKind = "type" | "sub" | "save";

export interface GraphNode {
  id: string; // "type:recipe", "sub:recipe/Desserts", "save:<id>"
  kind: GraphNodeKind;
  label: string;
  type?: SaveType; // type, sub and save nodes
  count?: number; // type and sub nodes
  from_intro?: boolean; // sub nodes: an interest or hobby from the intro
  save_id?: string; // save nodes
  thumb_url?: string | null; // save nodes
}

export type GraphLinkKind = "has" | "holds" | "related";

export interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
  weight?: number; // cosine, related links
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  counts: { saves: number; types: number; subcategories: number; related: number; from_intro: number };
}
