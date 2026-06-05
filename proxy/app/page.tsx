import { redirect } from "next/navigation";

// The root isn't a useful landing — send visitors straight to the user guide.
export default function Home() {
  redirect("/guide");
}
