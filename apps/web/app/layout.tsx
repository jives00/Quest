import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { TopNav } from "@/components/top-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quest - Personal Game Tracker",
  description: "Personal game tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="green-dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <TopNav />
          <main className="pt-16 min-h-screen flex flex-col">
            {children}
            <footer className="bg-surface-container-lowest border-t border-outline-variant/30 mt-12">
              <div className="max-w-page mx-auto px-margin-page py-10 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex flex-col items-center md:items-start gap-1">
                  <span className="text-on-surface font-bold italic tracking-tighter">QUEST</span>
                  <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-on-surface/30">© {new Date().getFullYear()} Personal Game Tracker</p>
                </div>
              </div>
            </footer>
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
