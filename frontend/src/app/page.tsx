"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        
      if (data.session) {
         router.replace("/dashboard");
         return;
      } else {
          setStatus(
            "Account created. Check your email to confirm your account, then sign in."
           );
      }

      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        router.replace("/dashboard");
        return;      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-white">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-gray-800 bg-gray-900 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">DocuLens AI</h1>
          <p className="mt-2 text-gray-400">
            Your intelligent document assistant
          </p>
        </div>

        <div className="grid grid-cols-2 rounded-lg bg-gray-800 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setStatus("");
            }}
            className={`rounded-md p-2 ${
              mode === "signup" ? "bg-blue-600" : "text-gray-300"
            }`}
          >
            Sign up
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setStatus("");
            }}
            className={`rounded-md p-2 ${
              mode === "login" ? "bg-blue-600" : "text-gray-300"
            }`}
          >
            Log in
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 outline-none focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 outline-none focus:border-blue-500"
              placeholder="At least 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 p-3 font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "signup"
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        {status && (
          <p
            aria-live="polite"
            className="break-words rounded-lg bg-gray-800 p-3 text-sm"
          >
            {status}
          </p>
        )}
      </div>
    </main>
  );
}
