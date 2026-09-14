import { notFound } from "next/navigation";

import PreviewPage from "@/components/trading/PreviewPage";

export const metadata = { title: "Preview" };

/** Design gallery on fixtures. Development only. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PreviewPage />;
}
