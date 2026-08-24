import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSV import",
  description: "Bulk-import user data from CSV files",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
