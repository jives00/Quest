import { LoginForm } from "./login-form";

export const metadata = { title: "Quest - Sign In" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-outline-variant bg-surface-container-low p-8">
        <h1 className="mb-stack-md text-h2 font-black italic tracking-tight text-primary-container">
          QUEST
        </h1>
        <LoginForm />
      </div>
    </div>
  );
}
