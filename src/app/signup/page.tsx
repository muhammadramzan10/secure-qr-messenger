"use client";

import React, { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  encryptText, 
  generateAsymmetricKeyPair, 
  exportPublicKey, 
  exportPrivateKey 
} from "@/lib/crypto";
import { ShieldAlert, Terminal, Lock, Mail, User, ArrowLeft, Loader, KeyRound } from "lucide-react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [cryptoStatus, setCryptoStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setCryptoStatus("GENERATING CRYPTO KEYPAIRS...");

    try {
      // 1. Generate asymmetric keypair locally before calling signup
      const pair = await generateAsymmetricKeyPair();
      setCryptoStatus("DERIVING SYMMETRIC KEYS...");
      
      const pubKeyString = await exportPublicKey(pair.publicKey);
      const encPrivateKey = await exportPrivateKey(pair.privateKey, password);

      setCryptoStatus("REGISTERING COGNITIVE NODE ON CLOUD...");

      // 2. Sign up on Supabase Auth
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          }
        }
      });

      if (authError) {
        setErrorMsg(authError.message);
        setCryptoStatus(null);
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setErrorMsg("Failed to register node credentials.");
        setCryptoStatus(null);
        setLoading(false);
        return;
      }

      setCryptoStatus("PATCHING DATABASE WITH CRYPTO KEYS...");

      // 3. Upload public key & encrypted private key to public.profiles table
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          public_key: pubKeyString,
          private_key_encrypted: encPrivateKey.encryptedPrivateKey,
          salt: encPrivateKey.salt,
          iv: encPrivateKey.iv,
          auth_tag: encPrivateKey.authTag,
        })
        .eq("id", authData.user.id);

      if (profileError) {
        // Fallback in case email confirmation is enabled (so session is pending)
        localStorage.setItem(`pending_crypto_keys_${authData.user.id}`, JSON.stringify({
          pubKeyString,
          encPrivateKey,
        }));
        setSuccessMsg("Registration successful! Please confirm your email to provision your profile keys.");
      } else {
        setSuccessMsg("Cryptographic identity created successfully! Redirecting...");
        setTimeout(() => {
          window.location.href = "/";
        }, 1500);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected cryptographic verification error occurred.");
    } finally {
      setCryptoStatus(null);
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
              <KeyRound className="w-12 h-12 text-green-400 animate-pulse" />
              <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
            </div>
            <h2 className="text-xl font-bold tracking-widest text-white">PROVISION COMM-NODE</h2>
            <p className="text-xs text-green-700 mt-1">GENERATE MATHEMATICAL IDENTITY</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSignup} className="space-y-4">
            
            {/* Full Name */}
            <div className="space-y-1">
              <label className="text-xs text-green-700 block font-bold">FULL NAME</label>
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                <input
                  type="text"
                  required
                  placeholder="Neuromancer"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
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
            <div className="space-y-1">
              <label className="text-xs text-green-700 block font-bold">PASSKEY (MIN 8 CHARACTERS)</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300"
                />
              </div>
              <p className="text-[10px] text-green-800 leading-normal">
                * Used locally to encrypt your private key. Never sent to the database.
              </p>
            </div>

            {/* Crypto Status Indicator */}
            {cryptoStatus && (
              <div className="text-xs border border-green-900 bg-green-950/20 text-green-400 p-3 rounded flex items-center gap-2">
                <Loader className="w-3.5 h-3.5 animate-spin" />
                <span>{cryptoStatus}</span>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed">
                [!] REGISTRATION FAILED: {errorMsg}
              </div>
            )}

            {/* Success Message */}
            {successMsg && (
              <div className="text-xs border border-emerald-900 bg-emerald-950/20 text-emerald-400 p-3 rounded leading-relaxed">
                [+] SUCCESS: {successMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 py-2.5 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-wider transition-all duration-300 rounded shadow-[0_0_10px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  PROCESSING SYMMETRIC SHIELD...
                </>
              ) : (
                "PROVISION NODE"
              )}
            </button>
          </form>

          {/* Links */}
          <div className="mt-8 border-t border-green-950 pt-4 text-center">
            <p className="text-xs text-green-700">
              ALREADY REGISTERED?{" "}
              <Link href="/login" className="text-green-400 font-bold hover:underline">
                [ LOG IN TO COMM-GRID ]
              </Link>
            </p>
          </div>

        </div>
      </main>

      {/* Terminal log warning */}
      <footer className="py-4 border-t border-green-950 text-center text-[10px] text-green-800 bg-black/90">
        WARNING: LOCAL CRYPTOGRAPHIC OPERATIONS ARE COMPUTATIONALLY INTENSIVE.
      </footer>
    </div>
  );
}
