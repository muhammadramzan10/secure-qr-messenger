"use client";

import React, { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { ShieldAlert, Terminal, Lock, Mail, ArrowLeft, Loader } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        // Successful login, redirect to homepage
        window.location.href = "/";
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono relative overflow-hidden select-none">
      {/* Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,16,16,0)+50%,rgba(0,0,0,0.25)+50%),linear-gradient(to_right,rgba(255,0,0,0.06)+33%,rgba(0,255,0,0.02)+33%,rgba(0,0,255,0.06)+66%)] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

      {/* Back button */}
      <div className="p-6 z-20">
        <Link href="/" className="flex items-center gap-2 text-xs text-green-700 hover:text-green-400 transition-all duration-300">
          <ArrowLeft className="w-4 h-4" /> [ BACK TO COMMAND GRID ]
        </Link>
      </div>

      <main className="flex-1 flex items-center justify-center p-6 z-20">
        <div className="w-full max-w-md border border-green-900 rounded bg-zinc-950/80 p-8 shadow-[0_0_20px_rgba(34,197,94,0.05)]">
          
          {/* Header */}
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="relative mb-3">
              <ShieldAlert className="w-12 h-12 text-green-400 animate-pulse" />
              <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
            </div>
            <h2 className="text-xl font-bold tracking-widest text-white">SECURE AUTHENTICATION</h2>
            <p className="text-xs text-green-700 mt-1">ACCESS ENCRYPTED COGNITIVE LAYER</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-6">
            
            {/* Email */}
            <div className="space-y-2">
              <label className="text-xs text-green-700 block font-bold">EMAIL IDENTITY</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                <input
                  type="email"
                  required
                  placeholder="user@network.net"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-xs text-green-700 block font-bold">ACCESS DECRYPT PASSKEY</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300"
                />
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed">
                [!] ERROR: {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-wider transition-all duration-300 rounded shadow-[0_0_10px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  DECODING CREDENTIALS...
                </>
              ) : (
                "LOG IN TO COMM-GRID"
              )}
            </button>
          </form>

          {/* Links */}
          <div className="mt-8 border-t border-green-950 pt-4 text-center">
            <p className="text-xs text-green-700">
              NO NODE CREATED?{" "}
              <Link href="/signup" className="text-green-400 font-bold hover:underline">
                [ SIGN UP NEW PROFILE ]
              </Link>
            </p>
          </div>

        </div>
      </main>

      {/* Terminal log warning */}
      <footer className="py-4 border-t border-green-950 text-center text-[10px] text-green-800 bg-black/90">
        WARNING: AUTHORIZED SECURE COMM-NODE ACCESS ONLY. ALL CONNECTIONS LOGGED.
      </footer>
    </div>
  );
}
