"use client";

import React, { useState, useEffect, memo } from "react";
import { createClient } from "@/utils/supabase/client";
import { encryptText } from "@/lib/crypto";
import QRCode from "qrcode";
import { 
  ShieldAlert, 
  Terminal, 
  Lock, 
  Key, 
  EyeOff, 
  Clock, 
  User, 
  ArrowLeft, 
  Loader, 
  QrCode, 
  Copy, 
  Check, 
  Download,
  AlertTriangle,
  FileText
} from "lucide-react";
import Link from "next/link";

interface Profile {
  id: string;
  full_name: string;
}

export default function EncryptPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  
  // Form states
  const [messageText, setMessageText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [expiry, setExpiry] = useState("1h"); // 10m, 1h, 1d, never
  const [isOneTime, setIsOneTime] = useState(true);
  const [label, setLabel] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  
  // UI states
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successPayload, setSuccessPayload] = useState<{
    qrToken: string;
    decryptUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString(),
    text
  });

  // Authenticate user and fetch other profiles
  useEffect(() => {
    const initPage = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        
        if (user) {
          setLogs((prev) => [...prev, createLog(`[+] Logged in as: ${user.email}`)]);
          
          // Fetch potential recipients
          const { data: profileList, error } = await supabase
            .from("profiles")
            .select("id, full_name")
            .neq("id", user.id);
            
          if (!error && profileList) {
            setProfiles(profileList);
            setLogs((prev) => [...prev, createLog(`[+] Found ${profileList.length} users available for chat.`)]);
          }
        } else {
          setLogs((prev) => [...prev, createLog("[!] Not logged in. Please sign in to encrypt messages.")]);
        }
      } catch (err: any) {
        setLogs((prev) => [...prev, createLog(`[-] Setup error: ${err.message}`)]);
      } finally {
        setAuthLoading(false);
      }
    };
    
    setLogs([
      createLog("Secure QR Encryption Tool"),
      createLog("[*] Getting things ready...")
    ]);
    initPage();
  }, []);

  const handleEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg("You need to be logged in to create messages.");
      return;
    }
    if (!messageText.trim()) {
      setErrorMsg("Please enter a message to encrypt.");
      return;
    }
    if (!passphrase) {
      setErrorMsg("Please enter a password to protect your message.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setLogs((prev) => [
      ...prev, 
      createLog("[*] Starting encryption..."),
      createLog(`[*] Message length: ${messageText.length} characters.`)
    ]);

    try {
      // 1. Client-Side Encryption
      setLogs((prev) => [...prev, createLog("[*] Generating encryption key from your password...")]);
      // Derive key and encrypt
      const encrypted = await encryptText(messageText, passphrase);
      
      setLogs((prev) => [
        ...prev,
        createLog("[+] Encryption key created successfully."),
        createLog("[*] Encrypting your message..."),
        createLog(`[+] Message encrypted.`),
        createLog(`    - Salt: ${encrypted.salt.substring(0, 10)}...`),
        createLog(`    - IV: ${encrypted.iv.substring(0, 10)}...`),
        createLog(`    - Encrypted text: ${encrypted.cipherText.substring(0, 12)}...`),
        createLog(`    - Verification tag: ${encrypted.authTag}`)
      ]);

      // 2. Compute expiration date
      let expiryTime: string | null = null;
      if (expiry !== "never") {
        const now = new Date();
        if (expiry === "10m") now.setMinutes(now.getMinutes() + 10);
        else if (expiry === "1h") now.setHours(now.getHours() + 1);
        else if (expiry === "1d") now.setHours(now.getHours() + 24);
        expiryTime = now.toISOString();
      }

      // 3. Generate secure random QR token
      const qrToken = crypto.randomUUID();
      setLogs((prev) => [...prev, createLog(`[*] Creating secure QR code...`)]);

      // 4. Send encrypted message record to Supabase messages table
      setLogs((prev) => [...prev, createLog("[*] Saving encrypted message to database...")]);
      const { data: messageData, error: msgError } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          recipient_id: recipientId || null,
          cipher_text: encrypted.cipherText,
          salt: encrypted.salt,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
          label: label || null,
          expiry_time: expiryTime,
          is_one_time: isOneTime,
          self_destruct: isOneTime, // self destruct if burn-on-read
          is_active: true,
          is_used: false,
          qr_token: qrToken
        })
        .select()
        .single();

      if (msgError) {
        throw new Error(`Supabase registration failed: ${msgError.message}`);
      }

      setLogs((prev) => [...prev, createLog("[+] Encrypted message saved successfully.")]);

      // 5. Construct decryption URL and render QR Code
      const decryptUrl = `${window.location.origin}/decrypt?token=${qrToken}`;
      setLogs((prev) => [...prev, createLog(`[*] Generating QR code image...`)]);
      
      const qrDataUrl = await QRCode.toDataURL(decryptUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: "#00FF00", // Green matrix elements
          light: "#000000" // Black background
        }
      });

      // 6. Register QR code representation in qr_codes table
      setLogs((prev) => [...prev, createLog("[*] Registering QR code in the system...")]);
      const { error: qrError } = await supabase
        .from("qr_codes")
        .insert({
          message_id: messageData.id,
          qr_data_url: qrDataUrl,
          qr_token: qrToken,
          scan_count: 0,
          is_active: true
        });

      if (qrError) {
        throw new Error(`Supabase QR code registry mapping failed: ${qrError.message}`);
      }

      setLogs((prev) => [
        ...prev, 
        createLog("[+] QR code created and ready to share!"),
        createLog("[!] All done! Your encrypted message is ready.")
      ]);

      setSuccessPayload({
        qrToken,
        decryptUrl,
        qrDataUrl
      });

    } catch (err: any) {
      setErrorMsg("Something went wrong while encrypting or uploading your message. Please try again.");
      setLogs((prev) => [...prev, createLog(`[-] Something went wrong: ${err.message}`)]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (successPayload) {
      navigator.clipboard.writeText(successPayload.decryptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setLogs((prev) => [...prev, createLog("[+] Decrypt link copied to clipboard.")]);
    }
  };

  const handleDownloadQR = () => {
    if (successPayload) {
      const link = document.createElement("a");
      link.href = successPayload.qrDataUrl;
      link.download = `secure-qr-${successPayload.qrToken.substring(0, 8)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setLogs((prev) => [...prev, createLog("[+] QR code image downloaded.")]);
    }
  };

  const handleReset = () => {
    setMessageText("");
    setPassphrase("");
    setExpiry("1h");
    setIsOneTime(true);
    setLabel("");
    setRecipientId("");
    setErrorMsg(null);
    setSuccessPayload(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Form cleared. Ready to encrypt another message.")
    ]);
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
          <span>SYMMETRIC CRYPTO GRIDS</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 z-20">
        
        {/* Left Column: Form / Result Panel */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-green-900 rounded bg-zinc-950/90 p-6 md:p-8 shadow-[0_0_20px_rgba(0,255,0,0.02)]">
            
            <div className="flex items-center gap-3 mb-6">
              <div className="relative">
                <QrCode className="w-8 h-8 text-green-400" />
                <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-white tracking-wider">PACK MESSAGES INTO QR CODES</h2>
                <p className="text-[10px] md:text-xs text-green-700">AES-GCM-256 CLIENT-SIDE PARALLAX ENCRYPTION</p>
              </div>
            </div>

            {authLoading ? (
              <div className="flex items-center justify-center py-12 gap-3 text-sm text-green-400 animate-pulse">
                <Loader className="w-5 h-5 animate-spin" />
                SYNCING GRID ID STATUS...
              </div>
            ) : !user ? (
              <div className="border border-red-950 bg-red-950/20 p-6 rounded text-center space-y-4">
                <AlertTriangle className="w-10 h-10 text-red-500 mx-auto animate-pulse" />
                <h3 className="text-white font-bold">Account Required</h3>
                <p className="text-xs text-red-400 max-w-md mx-auto leading-relaxed">
                  You need to be logged in to create and encrypt messages. Please log in first.
                </p>
                <div className="pt-2">
                  <Link 
                    href="/login" 
                    className="inline-block px-6 py-2 border border-green-500 hover:bg-green-500 hover:text-black font-bold text-xs rounded transition-all duration-300"
                  >
                    LOG IN TO YOUR ACCOUNT
                  </Link>
                </div>
              </div>
            ) : !successPayload ? (
              /* Encryption Form */
              <form onSubmit={handleEncrypt} className="space-y-6">
                
                {/* Message text */}
                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                    <FileText className="w-3.5 h-3.5" /> SECURE MESSAGE PAYLOAD (TEXT OR RAW JSON)
                  </label>
                  <textarea
                    required
                    rows={6}
                    placeholder="Enter the confidential payload coordinates or message data to secure..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="w-full p-4 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono resize-none"
                  />
                </div>

                {/* Password input */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                      <Lock className="w-3.5 h-3.5" /> DECRYPT PASSWORD (INTERACTIVE KEY)
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                      <input
                        type="password"
                        required
                        placeholder="••••••••••••"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-green-800 leading-tight">
                      * Required. Used to derive a unique AES-GCM key client-side. NOT sent to Supabase.
                    </p>
                  </div>

                  {/* Public Label */}
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                      <Terminal className="w-3.5 h-3.5" /> PUBLIC MATRIX LABEL
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Courier instructions, server access"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="w-full px-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                    />
                    <p className="text-[10px] text-green-800 leading-tight">
                      * Optional. Viewable by scanning terminals prior to decryption.
                    </p>
                  </div>
                </div>

                {/* Expiry and Recipients */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-green-950/50 pt-4">
                  
                  {/* Expiry selection */}
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                      <Clock className="w-3.5 h-3.5" /> DESTRUCTION EXPIRY DECK
                    </label>
                    <select
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="w-full px-3 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 outline-none rounded transition-all duration-300 font-mono cursor-pointer"
                    >
                      <option value="10m">10 MINUTES (EPHEMERAL)</option>
                      <option value="1h">1 HOUR (SHORT ACTION)</option>
                      <option value="1d">24 HOURS (STANDARD)</option>
                      <option value="never">NEVER (MANUAL BURN ONLY)</option>
                    </select>
                  </div>

                  {/* Recipient check */}
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold flex items-center gap-1.5 uppercase">
                      <User className="w-3.5 h-3.5" /> RECIPIENT NODE RESTRICTION
                    </label>
                    <select
                      value={recipientId}
                      onChange={(e) => setRecipientId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 outline-none rounded transition-all duration-300 font-mono cursor-pointer"
                    >
                      <option value="">PUBLIC DECRYPTION GRID (ANY NODE WITH PASSKEY)</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || p.id.substring(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Burn options */}
                <div className="flex items-center gap-3 border-t border-green-950/50 pt-4 pb-2">
                  <input
                    type="checkbox"
                    id="oneTimeBurn"
                    checked={isOneTime}
                    onChange={(e) => setIsOneTime(e.target.checked)}
                    className="w-4 h-4 border border-green-950 rounded bg-black text-green-500 focus:ring-0 focus:ring-offset-0 accent-green-500 cursor-pointer"
                  />
                  <label htmlFor="oneTimeBurn" className="text-xs text-green-400 select-none cursor-pointer">
                    <span className="font-bold text-white uppercase">BURN-ON-READ ATOMIC TRANSACTION:</span> 
                    <span className="text-green-700 ml-1 text-[11px]">Message is instantly shredded upon successful scan.</span>
                  </label>
                </div>

                {errorMsg && (
                  <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed">
                    [!] ENCRYPTION ERROR: {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded shadow-[0_0_15px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      ENVELOPING & TRANSMITTING METADATA...
                    </>
                  ) : (
                    "SECURE MESSAGING PACK & GENERATE QR"
                  )}
                </button>
              </form>
            ) : (
              /* Success Panel showing QR Matrix output */
              <div className="space-y-6 animate-fadeIn">
                <div className="border border-green-500 bg-green-950/10 p-4 rounded text-center flex items-center gap-3 text-xs text-green-400">
                  <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <span className="font-bold text-white uppercase">MESSAGE LOCK ACQUIRED:</span> Encrypted data successfully registered in the secure Supabase registry and linked to the active QR matrix token.
                  </div>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-8 justify-center py-4">
                  {/* The rendered QR */}
                  <div className="relative p-3 border-2 border-green-500 rounded bg-black flex items-center justify-center shadow-[0_0_25px_rgba(0,255,0,0.15)]">
                    <img 
                      src={successPayload.qrDataUrl} 
                      alt="Decryption QR Matrix"
                      className="w-48 h-48 md:w-56 md:h-56 select-none"
                    />
                    <div className="absolute top-0 left-0 border-t-2 border-l-2 border-green-400 w-4 h-4 -mt-[2px] -ml-[2px]" />
                    <div className="absolute top-0 right-0 border-t-2 border-r-2 border-green-400 w-4 h-4 -mt-[2px] -mr-[2px]" />
                    <div className="absolute bottom-0 left-0 border-b-2 border-l-2 border-green-400 w-4 h-4 -mb-[2px] -ml-[2px]" />
                    <div className="absolute bottom-0 right-0 border-b-2 border-r-2 border-green-400 w-4 h-4 -mb-[2px] -mr-[2px]" />
                  </div>

                  {/* QR Controls */}
                  <div className="flex-1 space-y-4 w-full md:w-auto">
                    <div className="space-y-1">
                      <span className="text-[10px] text-green-700 font-bold block uppercase">ACTIVE QR DECRYPT LINK</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={successPayload.decryptUrl}
                          className="w-full px-3 py-1.5 border border-green-950 bg-black/60 text-[10px] text-green-400 rounded outline-none font-mono"
                        />
                        <button
                          onClick={handleCopyLink}
                          className="px-3 py-1.5 border border-green-500 hover:bg-green-500 hover:text-black text-xs font-bold transition-all duration-300 rounded flex-shrink-0 flex items-center gap-1.5 cursor-pointer"
                        >
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied ? "COPIED" : "COPY"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-green-700 font-bold block uppercase">ACTIVE PAYLOAD ID TOKEN</span>
                      <input
                        type="text"
                        readOnly
                        value={successPayload.qrToken}
                        className="w-full px-3 py-1.5 border border-green-950 bg-black/60 text-[10px] text-green-500 rounded outline-none font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                      <button
                        onClick={handleDownloadQR}
                        className="py-2 border border-green-500 hover:bg-green-500 hover:text-black text-xs font-bold transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4" /> DOWNLOAD QR PNG
                      </button>
                      <button
                        onClick={handleReset}
                        className="py-2 border border-green-900 text-green-700 hover:border-green-500 hover:text-green-400 text-xs font-bold transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                      >
                        ENCRYPT NEW PACKET
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-green-950 pt-4 flex flex-col sm:flex-row items-center justify-between text-[10px] text-green-700">
                  <span>EXPIRY TIMER SET: {expiry === "never" ? "NEVER (MANUAL)" : `ACTIVE (${expiry})`}</span>
                  <span>ONE-TIME READ TRANS: {isOneTime ? "ON (DESTRUCT ON SCAN)" : "OFF"}</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Right Column: Interactive Console Feed */}
        <TelemetryConsole logs={logs} />

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

interface TelemetryConsoleProps {
  logs: { time: string; text: string }[];
}

const TelemetryConsole = memo(function TelemetryConsole({ logs }: TelemetryConsoleProps) {
  return (
    <div className="lg:col-span-5 flex flex-col min-h-[300px] lg:h-auto gap-6">
      <div className="border border-green-900 rounded bg-black/90 p-6 flex-1 flex flex-col shadow-[inset_0_0_15px_rgba(0,0,0,0.85)]">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-green-950/80 text-xs">
          <span className="flex items-center gap-2 text-white">
            <Terminal className="w-4 h-4 text-green-400" /> CRYPTOGRAPHIC PIPELINE TELEMETRY
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 text-[11px] leading-relaxed max-h-[400px] lg:max-h-none font-mono">
          {logs.map((log, index) => {
            if (!log) return null;
            let time = "";
            let text = "";
            if (typeof log === "object") {
              time = String(log.time || "");
              text = String(log.text || "");
            } else {
              text = String(log);
            }
            return (
              <div key={index} className="flex gap-2">
                <span className="text-green-700">[{time}]</span>
                <span className={`${
                  text.startsWith("[+") ? "text-emerald-400" : 
                  text.startsWith("[!") ? "text-yellow-400" : 
                  text.startsWith("[-") ? "text-red-400" : 
                  "text-green-500"
                }`}>
                  {text}
                </span>
              </div>
            );
          })}
        </div>

        <div className="border-t border-green-950 mt-4 pt-4 text-[10px] text-green-800 text-center">
          ENTROPY SOURCE: WINDOW.CRYPTO.GETRANDOMVALUES
        </div>
      </div>
    </div>
  );
});
