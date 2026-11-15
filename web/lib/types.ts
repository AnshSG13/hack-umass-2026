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
  /** Still waiting, but an event whose dates have passed: Actions lists it under Missed. */
  missed?: boolean;
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

/** How the app gives the person what they want from a reel (server: realize/intent.py). */
export type Deliver = "cook" | "shop" | "itinerary" | "calendar" | "workout" | "learn" | "keep";
export interface SaveAction {
  deliver: Deliver;
  need: string; // "make this tiramisu"
  cta: string; // "Cook this tiramisu tonight"
  pitch: string; // "7 ingredients, 15 minutes, step by step"
  schedule: boolean; // a set time belongs to this action (an event)
}
/** One reel's action in Home's "Ready for you". */
export interface ReadyAction extends SaveAction {
  save_id: string;
  type: SaveType;
  title: string;
  thumb_url: string | null;
  meta: string;
}

/** GET /api/remember: a just-vibes reel brought back on Home. Not a reminder. */
export interface RememberItem {
  save_id: string;
  title: string;
  thumb_url: string | null;
  saved_on: string;
  line: string; // "Remember this puppy growing up"
  day: string; // YYYY-MM-DD: a different reel each day
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
  action?: SaveAction | null; // null while the reel is being read or when it failed
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
  new: number; // saved since the last visit, or since its board was last opened
}
export interface TastesResponse {
  total: number;
  tastes: Taste[]; // only types with at least one save, largest first
  /** The greeting's line: "3 recipes, 4 workouts and 3 product picks". null with nothing to say. */
  recap: { window: "new" | "week"; parts: string[]; text: string } | null;
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
  /** false: an email account that has never been shown its Shortcut key. */
  shortcut_key?: boolean;
  expires_at: string | null;
  counts: { saves: number; by_type: Record<SaveType, number>; plans: Partial<Record<PlanStatus, number>> };
  profile: Profile | null;
  onboarded: boolean; // false: a real account that hasn't done the intro (only new ones with no saves are sent there)
}

// ---- the intro (/welcome) ----
export interface Profile {
  age_range: string | null;
  ethnicity: string[];
  interests: string[];
  hobbies: string[];
  starters?: Partial<Record<SaveType, string[]>>;
}

export interface OnboardingOptions {
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
  | { type: "error"; message: string }
  /** The answered turn was kept: the chat it went into (a new one on the first question). */
  | { type: "saved"; chat_id: string; title?: string };

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
  /** true: the reel didn't say, so the answer was looked up on the web. Assistant only. */
  web?: boolean;
  /** Up to 2 questions worth asking next. Assistant only. */
  follow_ups?: string[];
  /** An Ask chat's turn: the reels the answer showed, and how sure it was. */
  cards?: AskCard[];
  confidence?: "high" | "low" | "none" | null;
  /** The pages a web answer used; the answer's [n] markers point at these. */
  sources?: { n: number; title: string; url: string }[];
  /** For a recipe's nutrition: numbers kept only with a source (n points into sources). */
  macros?: {
    basis: "published" | "estimated";
    per: "serving" | "recipe";
    servings: number | null;
    values: Partial<Record<
      "calories" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g" | "sugar_g" | "sodium_mg",
      { value: number; source: number }
    >>;
  } | null;
}
export interface DiscussionSummary {
  id: string;
  title: string; // the first question
  questions: number;
  updated_at: string;
  preview: string;
}
export interface Discussion extends DiscussionSummary {
  /** null for an Ask chat, which is about all the saves rather than one reel. */
  save_id: string | null;
  kind: "reel" | "ask";
  messages: DiscussionMessage[];
}
/** GET /api/chats: every chat, Ask and reel ones together, newest first. */
export interface ChatSummary extends DiscussionSummary {
  kind: "reel" | "ask";
  reel: { save_id: string; title: string; type: SaveType | null; thumb_url: string | null } | null;
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
  actions?: ReadyAction[]; // one per reel not yet acted on, newest first
  started: Bundle[];
}

// ---- deliverables: something finished to send, made from one reel ----
export type DeliverableKind = "itinerary" | "invite" | "grocery_list" | "recipe_card" | "workout_card"
  | "shortlist" | "places_list" | "key_points" | "chat_notes";
export interface DeliverableOption {
  kind: DeliverableKind;
  label: string;          // "Itinerary to send"
  hint: string;           // "The days, stops, times and what they cost"
  needs: null | "trip";   // "trip": the trip plan has to be built first
}
export interface DeliverableItem { text: string; sub?: string; url?: string; url_label?: string }
export interface DeliverableBlock { heading: string; numbered?: boolean; items: DeliverableItem[] }
export interface Deliverable {
  id: string; kind: DeliverableKind; label: string; title: string;
  lede: string[]; blocks: DeliverableBlock[]; closing: string[];
  text: string;        // the whole message as plain text, ready to paste or send, link included
  share_path: string;  // "/d/<id>?t=<token>" on this site
  share_url: string;   // the same as an absolute link
  updated_at: string;
}
export interface PublicDeliverable extends Deliverable {
  reel: { title: string | null; creator: string | null; url: string | null; thumb_url: string | null };
  app_name: string;
}
/** GET /api/saves/{id}/deliverables: what this reel can make now, and what was made before. */
export interface DeliverablesResponse {
  options: DeliverableOption[];
  made: Deliverable[];
}

// ---- GET /api/saves/{id}/nutrition: an estimate per serving ----
export interface Nutrition {
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sodium_mg: number };
  servings: number;
  split_pct: { protein?: number; carbs?: number; fat?: number }; // share of calories, adds to 100
  lines_counted: number;
  lines_total: number;
  assumed: number; // lines with no amount in the reel, so a typical amount was assumed
  servings_from: "reel" | "estimate";
}
/** The recipe's own published nutrition, once the reel's chat has found it. It replaces the
 * estimate everywhere, so a recipe only ever shows one number. */
export interface PublishedNutrition {
  per: "serving" | "recipe";
  servings: number | null;
  values: Partial<Record<"calories" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g" | "sugar_g" | "sodium_mg", number>>;
  split_pct: { protein?: number; carbs?: number; fat?: number };
  sources: { n: number; title: string; url: string }[];
}
export interface NutritionResponse {
  nutrition: Nutrition | null;
  published: PublishedNutrition | null;
}

// ---- GET/POST /api/saves/{id}/shop: price research ----
export interface ShopOffer {
  product: string;
  store: string;
  price: number;
  price_text: string; // "$79.99"
  note: string;
  alternative: boolean; // a cheaper option for the same use, not the reel's product
  url: string; // the page the price came from
  via: string; // who that page belongs to: "Target", "Wirecutter"
}
export interface Shop {
  status: "building" | "ready" | "failed";
  offers: ShopOffer[];
  best: ShopOffer[]; // the lowest trusted price per product the reel names
  alternatives: ShopOffer[];
  checked_on: string | null; // "Nov 14"
  dropped: number; // prices left out because their source wasn't a store or review site we know
  error: string | null;
}

// ---- GET /api/graph: the knowledge graph ----
export type GraphNodeKind = "type" | "sub" | "save" | "interest";

export interface GraphNode {
  id: string; // "type:recipe", "sub:recipe/Desserts", "save:<id>", "interest:Baking"
  kind: GraphNodeKind;
  label: string;
  type?: SaveType; // type, sub and save nodes
  count?: number; // type and sub nodes
  save_id?: string; // save nodes
  thumb_url?: string | null; // save nodes
}

export type GraphLinkKind = "has" | "holds" | "related" | "likes";

export interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
  weight?: number; // cosine, related and likes links
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  counts: { saves: number; types: number; subcategories: number; related: number; interests: number; interests_total: number };
}
