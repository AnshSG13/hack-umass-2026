import { redirect } from "next/navigation";

// Actions moved into Home (the week, what's waiting, the shopping list). Old links still land.
export default function PlansPage() {
  redirect("/home");
}
