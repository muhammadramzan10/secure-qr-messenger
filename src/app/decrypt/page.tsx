"use client";

import React, { useState, useEffect, Suspense, memo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { decryptText } from "@/lib/crypto";
import { 
  ShieldAlert, 
  Terminal, 
  Lock, 
  Key, 
  Unlock, 
  ArrowLeft, 
  Loader, 
  AlertTriangle,
  Clipboard,
  CheckCircle,
  FileText,
  Activity,
  Flame
} from "lucide-react";
import Link from "next/link";

interface MessagePayload {
  id: string;
  cipher_text: string;
  salt: string;
  iv: string;
  auth_tag: string;
  is_one_time: boolean;
  self_destruct: boolean;
  expiry_time: string | null;
}

function DecryptContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  
  // URL token
  const urlToken = searchParams.get("token") || "";

  // Core states
  const [tokenInput, setTokenInput] = useState(urlToken);
  const [activeToken, setActiveToken] = useState(urlToken);
  const [clientIp, setClientIp] = useState("127.0.0.1");
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Stepper state
  // 1 = Enter Token / Confirm Retrieve
  // 2 = Enter Passphrase (Ciphertext is fetched)
  // 3 = Message Decrypted
  const [step, setStep] = useState(urlToken ? 1 : 1);
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString(),
    text
  });
  
  // Fetched data
  const [payload, setPayload] = useState<MessagePayload | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [decryptedMessage, setDecryptedMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch client IP on mount
  useEffect(() => {
    const fetchIp = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        if (res.ok) {
          const json = await res.json();
          if (json.ip) {
            setClientIp(json.ip);
          }
        }
      } catch (e) {
        // Fallback silently if offline or blocked by adblocker
      }
    };
    fetchIp();

    setLogs([
      createLog("SYSTEM INITIATED — QR DEPACKAGING GATEWAY"),
      createLog("[*] Standing by for secure token submission...")
    ]);
  }, []);

  // Update active token if search params change
  useEffect(() => {
    if (urlToken) {
      setActiveToken(urlToken);
      setTokenInput(urlToken);
      setLogs((prev) => [...prev, createLog(`[*] Decryption token detected in URL headers: ${urlToken}`)]);
    }
  }, [urlToken]);

  // Handler to parse URL or plain token input
  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;

    setErrorMsg(null);
    let extractedToken = tokenInput.trim();
    
    // Check if input is a full URL
    try {
      if (extractedToken.startsWith("http://") || extractedToken.startsWith("https://")) {
        const url = new URL(extractedToken);
        const t = url.searchParams.get("token");
        if (t) {
          extractedToken = t;
        }
      }
    } catch (_) {}

    setActiveToken(extractedToken);
    setLogs((prev) => [...prev, createLog(`[*] Manual token override committed: ${extractedToken}`)]);
  };

  // Step 1: Call RPC to retrieve message and trigger burn-on-read
  const handleRetrievePayload = async () => {
    if (!activeToken) return;

    setLoading(true);
    setErrorMsg(null);
    setLogs((prev) => [
      ...prev,
      createLog(`[*] Initiating database handshake for token: ${activeToken}`),
      createLog("[*] Gathering agent telemetry headers..."),
      createLog(`    - Node IP: ${clientIp}`),
      createLog(`    - Platform: ${navigator.platform || "Unknown"}`),
      createLog(`    - Browser Agent: ${navigator.userAgent.substring(0, 35)}...`)
    ]);

    try {
      // Invoke RPC
      const { data, error } = await supabase.rpc("fetch_and_burn_message", {
        p_qr_token: activeToken,
        p_ip: clientIp,
        p_device: navigator.platform || "Unknown",
        p_browser: navigator.userAgent || "Unknown"
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data || data.length === 0) {
        throw new Error("Target payload not found or inactive.");
      }

      // Supabase returns a list (table), we grab the first row
      const record = data[0] as MessagePayload;

      setLogs((prev) => [
        ...prev,
        createLog("[+] Handshake completed. Ciphertext envelope downloaded."),
        createLog(`[!] SECURITY NOTE: Message is active-burn. Destruction status: ${record.is_one_time ? "DESTROYED ON DATABASE" : "RETAINED (PERSISTENT)"}`),
        createLog(record.is_one_time ? "[!] WARNING: Server record has been shredded. Refreshing or closing this page will lose access forever." : "[*] Persistent QR record saved."),
        createLog("[*] Awaiting client keyphrase input...")
      ]);

      setPayload(record);
      setStep(2);

    } catch (err: any) {
      setErrorMsg("This message link is invalid, has expired, or has already been opened and deleted.");
      setLogs((prev) => [
        ...prev,
        createLog(`[-] HANDSHAKE TRANSACTION FAILED: ${err.message}`),
        createLog("[!] Security policy triggered: Access Blocked / Token Invalidated.")
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Client-side decryption
  const handleDecryptMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload || !passphrase) return;

    setDecrypting(true);
    setErrorMsg(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Initiating client-side decryption engine..."),
      createLog("[*] Deriving key from password (PBKDF2, Iterations: 100,000)...")
    ]);

    try {
      const decrypted = await decryptText(
        payload.cipher_text,
        payload.salt,
        payload.iv,
        payload.auth_tag,
        passphrase
      );

      setLogs((prev) => [
        ...prev,
        createLog("[+] Key derived successfully. PBKDF2 integrity match verified."),
        createLog("[*] Executing AES-GCM-256 decryption matrices..."),
        createLog("[+] DECRYPTION SUCCESSFUL. PLAINTEXT CONSOLE STREAMING ACTIVE.")
      ]);

      setDecryptedMessage(decrypted);
      setStep(3);

    } catch (err: any) {
      setErrorMsg("Incorrect password. Please verify the passcode and try again.");
      setLogs((prev) => [
        ...prev,
        createLog(`[-] Decryption failed: ${err.message}`),
        createLog("[-] Cryptographic signature invalid. Passphrase rejected."),
        createLog(payload.is_one_time 
          ? "[!] NOTE: Since this was a Burn-on-Read message, it has been shredded on Supabase. You cannot retrieve it again." 
          : "[!] Note: You can retry with a different password.")
      ]);
    } finally {
      setDecrypting(false);
    }
  };

  const handleCopyMessage = () => {
    if (decryptedMessage) {
      navigator.clipboard.writeText(decryptedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setLogs((prev) => [...prev, createLog("[+] Decrypted plaintext copied to clipboard.")]);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono relative overflow-hidden select-none selection:bg-green-500 selection:text-black">
      {/* Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,16,16,0)+50%,rgba(0,0,0,0.25)+50%),linear-gradient(to_right,rgba(255,0,0,0.06)+33%,rgba(0,255,0,0.02)+33%,rgba(0,0,255,0.06)+66%)] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

      {/* Header */}
      <header className="border-b border-green-950 bg-black/80 backdrop-blur-md sticky top-0 z-20 py-3 px-4 md:py-4 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-xs text-green-700 hover:text-green-400 transition-all duration-300">
          <ArrowLeft className="w-4 h-4" /> [ BACK TO COMMAND GRID ]
        </Link>
        <div className="flex items-center gap-2 px-3 py-1 rounded border border-green-900 bg-green-950/20 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>DECRYPTION TERMINAL GRIDS</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 z-20">
        
        {/* Left Column: Decrypt controls */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-green-900 rounded bg-zinc-950/90 p-6 md:p-8 shadow-[0_0_20px_rgba(0,255,0,0.02)]">
            
            <div className="flex items-center gap-3 mb-6">
              <div className="relative">
                <Unlock className="w-8 h-8 text-green-400" />
                <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-white tracking-wider">DECRYPT SCAN PAYLOAD</h2>
                <p className="text-[10px] md:text-xs text-green-700">AES-GCM-256 ZERO KNOWLEDGE ENDPOINT DECODER</p>
              </div>
            </div>

            {/* ERROR GENERAL */}
            {errorMsg && step === 1 && (
              <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-4 rounded leading-relaxed mb-6">
                [!] EXCEPTION DETECTED:
                <p className="mt-1 text-red-500 font-bold">{errorMsg}</p>
              </div>
            )}

            {/* STEP 1: Enter token / Handshake */}
            {step === 1 && (
              <div className="space-y-6">
                <form onSubmit={handleTokenSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold block uppercase">
                      DECRYPTION TOKEN OR SCAN URL
                    </label>
                    <input
                      type="text"
                      placeholder="Paste the full decrypt link or plain token hex value here..."
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      className="w-full px-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                    />
                  </div>
                  {tokenInput.trim() !== activeToken && (
                    <button
                      type="submit"
                      className="px-4 py-1.5 border border-green-700 hover:border-green-500 text-xs font-bold text-green-500 hover:text-green-400 rounded transition-all duration-300 cursor-pointer"
                    >
                      COMMIT NEW TOKEN
                    </button>
                  )}
                </form>

                {activeToken ? (
                  <div className="border border-green-950 bg-green-950/5 p-6 rounded space-y-4">
                    <div className="flex items-start gap-3">
                      <Flame className="w-5 h-5 text-red-500 animate-pulse flex-shrink-0" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white uppercase">One-Time Read Notice</h4>
                        <p className="text-xs text-green-700 leading-relaxed">
                          This is a single-use secure message. It will be permanently deleted from the cloud server as soon as it is opened. If you refresh or close this page before entering the password, you will lose access forever.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleRetrievePayload}
                      disabled={loading}
                      className="w-full py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded shadow-[0_0_15px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          HANDSHAKING WITH SUPABASE EDGE LAYER...
                        </>
                      ) : (
                        "RETRIEVE & HANDSHAKE PAYLOAD"
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="border border-green-950 bg-green-950/5 p-6 rounded text-center text-xs text-green-700">
                    Provide an active QR decryption token or URL above to mount the cryptographic block.
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Password prompt */}
            {step === 2 && payload && (
              <form onSubmit={handleDecryptMessage} className="space-y-6">
                
                <div className="border border-yellow-950 bg-yellow-950/15 p-4 rounded text-xs text-yellow-500 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 uppercase">
                    <Flame className="w-4 h-4 text-red-500" /> Secure Data Unlocked (Deleted from Server)
                  </div>
                  <p className="text-yellow-600 leading-relaxed">
                    The encrypted message has been downloaded to your browser and deleted from our cloud servers. It now exists only in your browser's volatile memory. Please enter the password below to decrypt and read it.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                    <Lock className="w-3.5 h-3.5" /> ENTER PACKET KEYPASS
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                    <input
                      type="password"
                      required
                      placeholder="Enter the passphrase to decrypt client-side..."
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed">
                    [!] DECRYPTION ERROR: {errorMsg}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={decrypting}
                    className="py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {decrypting ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        DECRYPTING...
                      </>
                    ) : (
                      "DECRYPT PACKET CONTENT"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setPayload(null);
                      setPassphrase("");
                      setLogs((prev) => [...prev, createLog("[*] Returned to Step 1. Discarded local cipher memory.")]);
                    }}
                    className="py-3 border border-green-950 hover:border-green-500 text-green-700 hover:text-green-400 font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                  >
                    ABORT CHANNEL
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: Decrypted success message */}
            {step === 3 && decryptedMessage !== null && (
              <div className="space-y-6 animate-fadeIn">
                <div className="border border-green-500 bg-green-950/10 p-4 rounded flex items-center gap-3 text-xs text-green-400">
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <span className="font-bold text-white uppercase">DECRYPTION COMPLETE:</span> Symmetric signature match verified. The message packet has been unlocked.
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                    <FileText className="w-3.5 h-3.5" /> DECRYPTED PLAINTEXT MESSAGE
                  </label>
                  <div className="w-full p-4 border border-green-500 bg-zinc-950/90 text-sm text-green-400 outline-none rounded font-mono break-all whitespace-pre-wrap select-text max-h-[300px] overflow-y-auto">
                    {decryptedMessage}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleCopyMessage}
                    className="flex-1 py-3.5 border border-green-500 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-wider transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Clipboard className="w-4 h-4" />
                    {copied ? "COPIED TO SYSTEM CLIPBOARD" : "COPY PLAINTEXT MESSAGE"}
                  </button>
                  <button
                    onClick={() => {
                      setStep(1);
                      setActiveToken("");
                      setTokenInput("");
                      setPayload(null);
                      setPassphrase("");
                      setDecryptedMessage(null);
                      setLogs((prev) => [...prev, createLog("[*] System reset. Clearing decryption cache.")]);
                    }}
                    className="py-3.5 px-6 border border-green-950 hover:border-green-500 text-green-700 hover:text-green-400 font-bold text-xs uppercase tracking-wider transition-all duration-300 rounded cursor-pointer text-center"
                  >
                    RESET GATEWAY
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Right Column: Console Log */}
        <DecryptionConsole logs={logs} />

      </main>

      {/* Footer */}
      <footer className="border-t border-green-950 py-4 px-6 md:px-12 text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] text-green-800 bg-black/90 z-20">
        <div>
          <span>OPERATIONAL STATUS: NOMINAL</span>
          <span className="mx-2">|</span>
          <span>LOCATION ENCRYPTION NODE: LOCALHOST</span>
        </div>
        <div>
          <span>© 2026 SECURE QR CRYPTO MESSENGER. FREE STAGING SANDBOX.</span>
        </div>
      </footer>
    </div>
  );
}

interface DecryptionConsoleProps {
  logs: { time: string; text: string }[];
}

const DecryptionConsole = memo(function DecryptionConsole({ logs }: DecryptionConsoleProps) {
  return (
    <div className="lg:col-span-5 flex flex-col min-h-[300px] lg:h-auto gap-6">
      <div className="border border-green-900 rounded bg-black/90 p-6 flex-1 flex flex-col shadow-[inset_0_0_15px_rgba(0,0,0,0.85)]">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-green-950/80 text-xs">
          <span className="flex items-center gap-2 text-white">
            <Terminal className="w-4 h-4 text-green-400" /> TRANSACTION HANDSHAKE LOGGER
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 text-[11px] leading-relaxed max-h-[400px] lg:max-h-none font-mono">
          {logs.map((log, index) => (
            <div key={index} className="flex gap-2">
              <span className="text-green-700">[{log.time}]</span>
              <span className={`${
                log.text.startsWith("[+") ? "text-emerald-400" : 
                log.text.startsWith("[!") ? "text-yellow-400" : 
                log.text.startsWith("[-") ? "text-red-400" : 
                "text-green-500"
              }`}>
                {log.text}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-green-950 mt-4 pt-4 text-[10px] text-green-800 text-center">
          SECURE DECRYPT PLATFORM GRID NODE
        </div>
      </div>
    </div>
  );
});

export default function DecryptPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono items-center justify-center">
        <Loader className="w-8 h-8 text-green-400 animate-spin mb-4" />
        <span className="text-xs uppercase tracking-wider animate-pulse">Initializing Security Decryption Deck...</span>
      </div>
    }>
      <DecryptContent />
    </Suspense>
  );
}
