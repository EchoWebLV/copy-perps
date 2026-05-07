import { redirect } from "next/navigation";

// Launch: root URL goes straight to the feed. The pre-launch waitlist
// landing is preserved in components/landing/WaitlistForm + the
// /api/waitlist endpoint should we ever need to switch it back on; just
// re-import WaitlistForm here.
export default function HomePage() {
  redirect("/feed");
}
