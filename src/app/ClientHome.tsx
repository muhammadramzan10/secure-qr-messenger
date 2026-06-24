"use client";

import { useEffect, useState, memo } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  ShieldAlert, 
  QrCode, 
  Unlock, 
  MessageSquare, 
  FileLock2, 
  Terminal, 
  Activity, 
  UserCheck, 
  Database,
  CheckCircle,
  AlertTriangle,
  LogOut,
  LogIn,
  Clock,
  Eye,
  Trash2,
  LockKeyhole,
  RefreshCw
} from "lucide-react";
import Link from "next/link";

interface Todo {
  id: number | string;
  name?: string;
  title?: string;
  is_complete?: boolean;
  completed?: boolean;
  full_name?: string;
  email?: string;
}

interface ClientHomeProps {
  initialTodos: Todo[] | null;
  dbError: string | null;
}

interface ScanLog {
  id: string;
  status: string;
  ip_address: string;
  device_info: string;
  browser: string;
  created_at: string;
  qr_codes: {
    qr_token: string;
    messages: {
      label: string | null;
    } | null;
  } | null;
}

export default function ClientHome({ initialTodos, dbError }: ClientHomeProps) {
  const supabase = createClient();
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const [dbStatus, setDbStatus] = useState<"connecting" | "offline" | "online">("connecting");

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString(),
    text
  });
  
  // Auth & Profile states
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Clock state
  const [systemTime, setSystemTime] = useState("");

  // Statistics states
  const [stats, setStats] = useState({
    symmetricQrs: 0,
    filesCount: 0,
    chatsCount: 0,
    totalScans: 0,
    successScans: 0,
    expiredScans: 0,
    blockedScans: 0
  });
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  // Digital Clock useEffect
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString() + "." + String(now.getMilliseconds()).padStart(3, "0");
      setSystemTime(`[ ${timeStr} ZULU ]`);
    };
    const clockInterval = setInterval(updateTime, 45);
    return () => clearInterval(clockInterval);
  }, []);

  // Authenticated user checks & pending keys upload handler
  useEffect(() => {
    const checkUserAndKeys = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        
        if (user) {
          // Fetch public profile record
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();
          
          if (!error && data) {
            setProfile(data);
            
            // Check for pending keys generated during a signup that required email confirmation
            const pendingKeysStr = localStorage.getItem(`pending_crypto_keys_${user.id}`);
            if (pendingKeysStr) {
              setLogs((prev) => [...prev, createLog("[*] Found saved encryption keys. Syncing to your profile...")]);
              const { pubKeyString, encPrivateKey } = JSON.parse(pendingKeysStr);
              
              const { error: patchError } = await supabase
                .from("profiles")
                .update({
                  public_key: pubKeyString,
                  private_key_encrypted: encPrivateKey.encryptedPrivateKey,
                  salt: encPrivateKey.salt,
                  iv: encPrivateKey.iv,
                  auth_tag: encPrivateKey.authTag,
                })
                .eq("id", user.id);

              if (!patchError) {
                localStorage.removeItem(`pending_crypto_keys_${user.id}`);
                setLogs((prev) => [...prev, createLog("[+] Encryption keys synced to your profile successfully.")]);
                
                // Fetch refreshed profile
                const { data: refProfile } = await supabase
                  .from("profiles")
                  .select("*")
                  .eq("id", user.id)
                  .single();
                setProfile(refProfile);
              } else {
                setLogs((prev) => [...prev, createLog(`[-] Could not sync keys: ${patchError.message}`)]);
              }
            }
          }
          // Fetch stats for authenticated user
          fetchMetrics(user.id);
        }
      } catch (err: any) {
        console.error("Auth sync error:", err);
      } finally {
        setAuthLoading(false);
      }
    };

    checkUserAndKeys();
  }, []);

  // Fetch metrics and scan logs
  const fetchMetrics = async (userId: string) => {
    setStatsLoading(true);
    try {
      // 1. Fetch QRs count (messages where encrypted_aes_key is null or recipient_id is null)
      const { count: qrCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("encrypted_aes_key", null);

      // 2. Fetch Files count
      const { count: fileCount } = await supabase
        .from("files")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      // 3. Fetch Chats count (distinct conversation partners)
      const { data: sentMsgs } = await supabase
        .from("messages")
        .select("recipient_id")
        .eq("user_id", userId)
        .not("recipient_id", "is", null);

      const { data: recMsgs } = await supabase
        .from("messages")
        .select("user_id")
        .eq("recipient_id", userId);

      const partners = new Set<string>();
      sentMsgs?.forEach((m) => partners.add(m.recipient_id));
      recMsgs?.forEach((m) => partners.add(m.user_id));

      // 4. Fetch Scan Logs (RLS automatically filters to scan events owned by current user)
      const { data: scanLogsData, error: scanLogsError } = await supabase
        .from("scan_logs")
        .select(`
          id,
          status,
          ip_address,
          device_info,
          browser,
          created_at,
          qr_codes (
            qr_token,
            messages (
              label
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (scanLogsError) throw scanLogsError;

      const logsArray = (scanLogsData || []) as unknown as ScanLog[];
      setScanLogs(logsArray);

      // Aggregate status counts
      const successScans = logsArray.filter(l => l.status === "success").length;
      const expiredScans = logsArray.filter(l => l.status === "failed_expired").length;
      const blockedScans = logsArray.filter(l => l.status === "failed_already_used").length;

      setStats({
        symmetricQrs: qrCount || 0,
        filesCount: fileCount || 0,
        chatsCount: partners.size,
        totalScans: logsArray.length,
        successScans,
        expiredScans,
        blockedScans
      });

    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Could not load stats: ${err.message}`)]);
    } finally {
      setStatsLoading(false);
    }
  };

  // Cyberpunk starting logs console feed
  useEffect(() => {
    const startupLogs = [
      "Welcome to Secure QR Messenger",
      "[*] Connecting to server...",
      "[*] Setting up encryption engine...",
      "[*] Preparing secure messaging tools...",
      "[+] Encryption ready (AES-256 with password protection).",
      "[*] Checking database connection...",
    ];

    let logIndex = 0;
    const interval = setInterval(() => {
      if (logIndex < startupLogs.length) {
        setLogs((prev) => [...prev, createLog(startupLogs[logIndex])]);
        logIndex++;
      } else {
        clearInterval(interval);
        if (dbError) {
          setDbStatus("offline");
          setLogs((prev) => [
            ...prev,
            createLog(`[-] Database connection failed: ${dbError}`),
            createLog("[!] Please check your server settings."),
            createLog("[!] Make sure the database is properly set up.")
          ]);
        } else {
          setDbStatus("online");
          const profilesCount = initialTodos ? initialTodos.length : 0;
          setLogs((prev) => [
            ...prev,
            createLog("[+] Database connected successfully."),
            createLog(`[+] Found ${profilesCount} registered users.`),
            ...(initialTodos ? initialTodos.map(t => createLog(`   - ${t.full_name || t.email || 'Anonymous'}`)) : []),
            createLog("[!] Everything is secure. Ready to go.")
          ]);
        }
      }
    }, 450);

    return () => clearInterval(interval);
  }, [initialTodos, dbError]);

  const handleLogout = async () => {
    setLogs((prev) => [...prev, createLog("[*] Signing out...")]);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setStats({
      symmetricQrs: 0,
      filesCount: 0,
      chatsCount: 0,
      totalScans: 0,
      successScans: 0,
      expiredScans: 0,
      blockedScans: 0
    });
    setScanLogs([]);
    setLogs((prev) => [...prev, createLog("[+] Signed out successfully.")]);
  };

  // SVG Chart variables
  const maxScanStatus = Math.max(stats.successScans, stats.expiredScans, stats.blockedScans, 1);
  const successPercentage = (stats.successScans / maxScanStatus) * 100;
  const expiredPercentage = (stats.expiredScans / maxScanStatus) * 100;
  const blockedPercentage = (stats.blockedScans / maxScanStatus) * 100;

  return (
    <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono relative overflow-hidden select-none selection:bg-green-500 selection:text-black">
      {/* Cyberpunk Scanlines Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,16,16,0)+50%,rgba(0,0,0,0.25)+50%),linear-gradient(to_right,rgba(255,0,0,0.06)+33%,rgba(0,255,0,0.02)+33%,rgba(0,0,255,0.06)+66%)] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

      {/* Futuristic Header */}
      <header className="border-b border-green-950 bg-black/80 backdrop-blur-md sticky top-0 z-20 py-3 px-4 md:py-4 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <ShieldAlert className="w-8 h-8 text-green-400 animate-pulse" />
            <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-widest text-green-400">
              SECURE <span className="text-white">QR</span> MESSENGER
            </h1>
            <p className="text-[10px] md:text-xs text-green-700 tracking-wider">
              CLIENT-SIDE END-TO-END CRYPTO ENGINE
            </p>
          </div>
        </div>

        {/* Live Network & Clock */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="text-green-400 font-bold tracking-wider">
            {systemTime}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-green-900 bg-green-950/20">
            <Database className="w-3.5 h-3.5 text-green-400" />
            <span>DATABASE: </span>
            {dbStatus === "connecting" && (
              <span className="text-yellow-400 animate-pulse">INIT...</span>
            )}
            {dbStatus === "offline" && (
              <span className="text-red-400 font-bold">ERROR</span>
            )}
            {dbStatus === "online" && (
              <span className="text-emerald-400 font-bold">SUPABASE</span>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-green-900 bg-green-950/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-emerald-400">AES-GCM-256</span>
          </div>
        </div>
      </header>

      {/* Main Command Center Dashboard */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 flex flex-col gap-6 z-10">
        
        {/* Top Section: Welcome Info & Stats Counters */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Welcome Info Box (7 columns) */}
          <div className="lg:col-span-7 border border-green-900 rounded p-6 bg-gradient-to-br from-zinc-950/90 to-black flex flex-col justify-between shadow-[0_0_15px_rgba(0,255,0,0.01)]">
            <div>
              <h2 className="text-base md:text-lg font-bold text-white mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-400 animate-pulse" /> SECURITY OPERATIONS CENTER
              </h2>
              <p className="text-[11px] md:text-xs text-green-700 leading-relaxed">
                Welcome to the zero-knowledge operations grid. Encrypt sensitive payloads and files symmetrically into expiring or self-shredding QR packages. Alternatively, open direct end-to-end asymmetric message tunnels protected by browser cryptography keys. Decrypt credentials securely on any edge device without saving key secrets in cloud storage.
              </p>
            </div>
            {user && (
              <div className="mt-4 p-3 border border-green-950 rounded bg-green-950/5 flex items-center justify-between text-xs text-green-400">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span>ACTIVE COMMUNICATIONS TETHER SECURED</span>
                </span>
                <span className="text-[10px] text-green-700 uppercase">ONLINE</span>
              </div>
            )}
          </div>

          {/* Stats Metrics Deck (5 columns) */}
          <div className="lg:col-span-5 border border-green-900 rounded p-6 bg-zinc-950/90 flex flex-col justify-between">
            <h3 className="text-[11px] md:text-xs font-bold text-white mb-4 flex items-center gap-1.5 uppercase">
              <Terminal className="w-4 h-4 text-green-400 animate-pulse" /> NODE STATS TELEMETRY
            </h3>
            
            {statsLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-green-400 animate-pulse gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                POLLING LEDGER METRICS...
              </div>
            ) : !user ? (
              <div className="py-6 text-center text-xs text-green-700 italic">
                Node metrics offline. Please log in to unlock stats telemetry.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-green-950 bg-black/45 p-3 rounded text-center">
                  <span className="text-[10px] text-green-700 block uppercase">QR MESSAGES</span>
                  <span className="text-2xl font-bold text-white">{stats.symmetricQrs}</span>
                </div>
                <div className="border border-green-950 bg-black/45 p-3 rounded text-center">
                  <span className="text-[10px] text-green-700 block uppercase">SECURE FILES</span>
                  <span className="text-2xl font-bold text-white">{stats.filesCount}</span>
                </div>
                <div className="border border-green-950 bg-black/45 p-3 rounded text-center">
                  <span className="text-[10px] text-green-700 block uppercase">E2E CHATS</span>
                  <span className="text-2xl font-bold text-white">{stats.chatsCount}</span>
                </div>
                <div className="border border-green-950 bg-black/45 p-3 rounded text-center">
                  <span className="text-[10px] text-green-700 block uppercase">TOTAL SCANS</span>
                  <span className="text-2xl font-bold text-white">{stats.totalScans}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Grid (Card deck of 4 buttons) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Action 1: QR Generator */}
          <Link 
            href="/encrypt"
            className="border border-green-950 hover:border-green-500 rounded p-6 bg-zinc-950/40 hover:bg-green-950/10 transition-all duration-300 group cursor-pointer block"
          >
            <div className="flex items-center justify-between mb-4">
              <QrCode className="w-8 h-8 text-green-500 group-hover:text-green-400 transition-colors" />
              <span className="text-xs border border-green-900 px-2 py-0.5 rounded text-green-700">01</span>
            </div>
            <h3 className="text-white font-bold mb-2 group-hover:text-green-400 transition-colors text-xs md:text-sm">
              Encrypt & Generate QR
            </h3>
            <p className="text-[10px] md:text-[11px] text-green-700 leading-relaxed">
              Pack text into client-side symmetrically encrypted QR codes with customizable expiry timers and burn-on-read options.
            </p>
          </Link>

          {/* Action 2: Decrypt / Scan */}
          <Link 
            href="/decrypt"
            className="border border-green-950 hover:border-green-500 rounded p-6 bg-zinc-950/40 hover:bg-green-950/10 transition-all duration-300 group cursor-pointer block"
          >
            <div className="flex items-center justify-between mb-4">
              <Unlock className="w-8 h-8 text-green-500 group-hover:text-green-400 transition-colors" />
              <span className="text-xs border border-green-900 px-2 py-0.5 rounded text-green-700">02</span>
            </div>
            <h3 className="text-white font-bold mb-2 group-hover:text-green-400 transition-colors text-xs md:text-sm">
              Decrypt scan / Token
            </h3>
            <p className="text-[10px] md:text-[11px] text-green-700 leading-relaxed">
              Unlock encrypted text payloads by pasting dynamic lookup token links or scanning scannable QR coordinate sheets.
            </p>
          </Link>

          {/* Action 3: Chat E2E */}
          <Link 
            href="/chat"
            className="border border-green-950 hover:border-green-500 rounded p-6 bg-zinc-950/40 hover:bg-green-950/10 transition-all duration-300 group cursor-pointer block"
          >
            <div className="flex items-center justify-between mb-4">
              <MessageSquare className="w-8 h-8 text-green-500 group-hover:text-green-400 transition-colors" />
              <span className="text-xs border border-green-900 px-2 py-0.5 rounded text-green-700">03</span>
            </div>
            <h3 className="text-white font-bold mb-2 group-hover:text-green-400 transition-colors text-xs md:text-sm">
              Direct E2E Chat
            </h3>
            <p className="text-[10px] md:text-[11px] text-green-700 leading-relaxed">
              Establish secure asymmetric direct message chats. Payload contents are encrypted using recipient public keys.
            </p>
          </Link>

          {/* Action 4: Secured File Storage */}
          <Link 
            href="/files"
            className="border border-green-950 hover:border-green-500 rounded p-6 bg-zinc-950/40 hover:bg-green-950/10 transition-all duration-300 group cursor-pointer block"
          >
            <div className="flex items-center justify-between mb-4">
              <FileLock2 className="w-8 h-8 text-green-500 group-hover:text-green-400 transition-colors" />
              <span className="text-xs border border-green-900 px-2 py-0.5 rounded text-green-700">04</span>
            </div>
            <h3 className="text-white font-bold mb-2 group-hover:text-green-400 transition-colors text-xs md:text-sm">
              Encrypted File Box
            </h3>
            <p className="text-[10px] md:text-[11px] text-green-700 leading-relaxed">
              Upload images, PDFs, or keys symmetrically encrypted client-side. Secured in buckets with absolute metadata obfuscation.
            </p>
          </Link>
        </div>

        {/* Bottom Section: Scan logs & Charts (Grid layout) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* LEFT: Live Scan Audit Logs Feed (7 columns) */}
          <div className="lg:col-span-7 border border-green-900 rounded bg-zinc-950/90 p-6 flex flex-col h-[400px]">
            <h3 className="text-xs font-bold text-white mb-4 flex items-center justify-between uppercase flex-shrink-0">
              <span className="flex items-center gap-1.5"><Eye className="w-4 h-4 text-green-400" /> SCAN TRAFFIC AUDIT TRAIL</span>
              {user && (
                <button 
                  onClick={() => fetchMetrics(user.id)}
                  className="p-1 border border-green-950 hover:border-green-500 rounded transition-all cursor-pointer"
                  title="Manual telemetry sync"
                >
                  <RefreshCw className={`w-3 h-3 ${statsLoading ? "animate-spin" : ""}`} />
                </button>
              )}
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 text-xs font-mono">
              {!user ? (
                <div className="h-full flex items-center justify-center text-green-800 italic">
                  Audit logs feed offline. Please authenticate user session to view audit logs.
                </div>
              ) : scanLogs.length > 0 ? (
                scanLogs.map((log) => (
                  <div key={log.id} className="border border-green-950/60 bg-black/40 p-2.5 rounded flex flex-col md:flex-row md:items-center justify-between gap-2 text-[10px]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-green-700">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                        <span className="text-white font-bold">QR Token: {log.qr_codes?.qr_token.substring(0, 8)}...</span>
                        {log.qr_codes?.messages?.label && (
                          <span className="px-1 py-0.2 text-[9px] rounded bg-green-950/40 text-green-500 border border-green-950">
                            Label: {log.qr_codes.messages.label}
                          </span>
                        )}
                      </div>
                      <div className="text-green-800 leading-tight">
                        IP: {log.ip_address} | Browser: {log.browser.substring(0, 20)}... | Device: {log.device_info}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {log.status === "success" && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-900 font-bold uppercase tracking-wider text-[8px] inline-flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping" /> SUCCESS
                        </span>
                      )}
                      {log.status === "failed_expired" && (
                        <span className="px-2 py-0.5 rounded bg-yellow-950 text-yellow-500 border border-yellow-900 font-bold uppercase tracking-wider text-[8px] inline-flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-yellow-500" /> EXPIRED
                        </span>
                      )}
                      {log.status === "failed_already_used" && (
                        <span className="px-2 py-0.5 rounded bg-red-950 text-red-500 border border-red-900 font-bold uppercase tracking-wider text-[8px] inline-flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" /> SHREDDED
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-green-700 italic border border-dashed border-green-950/50 rounded">
                  No scan logs registered on the network telemetry grid.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Visual SVG Traffic Analytics (5 columns) */}
          <div className="lg:col-span-5 border border-green-900 rounded bg-zinc-950/90 p-6 flex flex-col justify-between h-[400px]">
            <h3 className="text-xs font-bold text-white uppercase flex-shrink-0 flex items-center gap-1.5 mb-4">
              <Activity className="w-4 h-4 text-green-400" /> SCAN TRAFFIC DISTRIBUTION
            </h3>

            {!user ? (
              <div className="flex-1 flex items-center justify-center text-green-800 italic text-xs">
                Traffic visualization locked. Authentication required.
              </div>
            ) : stats.totalScans === 0 ? (
              <div className="flex-1 flex items-center justify-center text-green-700 italic text-xs">
                No scan distributions recorded to compile charts.
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-around">
                {/* SVG Visual Representation Bar Grid */}
                <div className="space-y-4 font-mono text-xs">
                  {/* Success Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-emerald-400 font-bold">SUCCESSFUL DECIPHERS</span>
                      <span className="text-white">{stats.successScans} / {stats.totalScans}</span>
                    </div>
                    <div className="w-full bg-black border border-green-950 h-3 rounded overflow-hidden relative">
                      <div 
                        className="bg-emerald-500 h-full shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-500" 
                        style={{ width: `${(stats.successScans / stats.totalScans) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Expired Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-yellow-400 font-bold">EXPIRED SCAN BLOCKS</span>
                      <span className="text-white">{stats.expiredScans} / {stats.totalScans}</span>
                    </div>
                    <div className="w-full bg-black border border-green-950 h-3 rounded overflow-hidden relative">
                      <div 
                        className="bg-yellow-500 h-full shadow-[0_0_10px_rgba(234,179,8,0.5)] transition-all duration-500" 
                        style={{ width: `${(stats.expiredScans / stats.totalScans) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Blocked/Shredded Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-red-400 font-bold">SHREDDED SCAN BLOCKS</span>
                      <span className="text-white">{stats.blockedScans} / {stats.totalScans}</span>
                    </div>
                    <div className="w-full bg-black border border-green-950 h-3 rounded overflow-hidden relative">
                      <div 
                        className="bg-red-500 h-full shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-all duration-500" 
                        style={{ width: `${(stats.blockedScans / stats.totalScans) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Minimalist SVG pie telemetry */}
                <div className="flex items-center justify-center pt-2 gap-8 text-[9px] text-green-700">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                    <span>SUCCESS: {((stats.successScans / stats.totalScans) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.5)]" />
                    <span>EXPIRED: {((stats.expiredScans / stats.totalScans) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]" />
                    <span>SHREDDED: {((stats.blockedScans / stats.totalScans) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Telemetry sidebar & auth panel (Bottom horizontal row) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Identity Telemetry Card (7 columns) */}
          <div className="lg:col-span-7 border border-green-900 rounded p-6 bg-zinc-950/80">
            <h3 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-green-400" /> SECURED ENDPOINT STATE
            </h3>
            
            {authLoading ? (
              <div className="text-xs text-green-700 animate-pulse">Syncing session telemetry...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-[11px] leading-relaxed">
                <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                  <span className="text-green-700">IDENTITY STATUS:</span>
                  <span className={user ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                    {user ? "AUTHENTICATED NODE" : "UNREGISTERED GUEST"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                  <span className="text-green-700">ACTIVE SESSION:</span>
                  <span className="text-white truncate max-w-[150px]">
                    {user ? user.email : "NONE (EPHEMERAL)"}
                  </span>
                </div>
                {profile && (
                  <>
                    <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                      <span className="text-green-700">USER PROFILE:</span>
                      <span className="text-white truncate max-w-[150px]">{profile.full_name}</span>
                    </div>
                    <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                      <span className="text-green-700">PUBLIC KEY STATUS:</span>
                      <span className={profile.public_key ? "text-emerald-400 font-bold" : "text-yellow-500 font-bold"}>
                        {profile.public_key ? "PROVISIONED" : "UNKEYED"}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                  <span className="text-green-700">ENTROPY STRENGTH:</span>
                  <span className="text-emerald-400 font-bold">256-BIT CRYPTO STRONG</span>
                </div>
                <div className="flex justify-between border-b border-green-950/50 pb-1.5">
                  <span className="text-green-700">CONNECTION:</span>
                  <span className="text-emerald-400 font-bold">SSL ENCRYPTED SECURE</span>
                </div>
              </div>
            )}

            {!authLoading && (
              user ? (
                <button 
                  onClick={handleLogout}
                  className="w-full mt-6 py-2 border border-red-500 hover:bg-red-500 hover:text-black text-xs font-bold transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  DEAUTHORIZE / LOG OUT
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2 mt-6">
                  <Link 
                    href="/login" 
                    className="py-2 border border-green-500 hover:bg-green-500 hover:text-black text-center text-xs font-bold transition-all duration-300 rounded flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" /> LOGIN
                  </Link>
                  <Link 
                    href="/signup" 
                    className="py-2 border border-green-500 hover:bg-green-500 hover:text-black text-center text-xs font-bold transition-all duration-300 rounded flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    SIGN UP
                  </Link>
                </div>
              )
            )}
          </div>

          {/* Database Test Panel (5 columns) */}
          <div className="lg:col-span-5 border border-green-900 rounded bg-zinc-950/40 p-6 flex flex-col justify-between">
            <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
              <Database className="w-4 h-4 text-green-400" /> DATABASE HANDSHAKE TEST (PROFILES)
            </h3>
            
            {dbStatus === "connecting" && (
              <div className="text-xs text-yellow-400 animate-pulse my-4">
                Querying Supabase database edge...
              </div>
            )}

            {dbStatus === "offline" && (
              <div className="text-xs border border-red-950 bg-red-950/20 p-3 rounded flex items-start gap-2 text-red-400 my-4">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Unable to connect</p>
                  <p className="text-red-500 leading-normal text-[10px]">We are having trouble connecting to our secure servers. Please check your network connection or try again later.</p>
                </div>
              </div>
            )}

            {dbStatus === "online" && (
              <div className="text-[11px] my-3">
                {initialTodos && initialTodos.length > 0 ? (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[80px] overflow-y-auto pr-1">
                    {initialTodos.map((profile: any) => (
                      <li key={profile.id} className="border border-green-950 bg-green-950/5 p-1.5 rounded flex items-center justify-between">
                        <span className="text-green-400 truncate max-w-[120px]">{profile.full_name || profile.email}</span>
                        <span className="text-[8px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-900">ACTIVE</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-700 italic text-[10px]">No active connection logs found.</p>
                )}
              </div>
            )}

            <div className="text-[10px] text-green-800 leading-normal border-t border-green-950/50 pt-2">
              * Connection check: ensures secure real-time connectivity to the server network.
            </div>
          </div>
        </div>

        {/* Interactive Live Log Terminal Feed */}
        <DashboardConsole logs={logs} />

      </main>

      {/* Cyberpunk Status Footer */}
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

interface DashboardConsoleProps {
  logs: { time: string; text: string }[];
}

const DashboardConsole = memo(function DashboardConsole({ logs }: DashboardConsoleProps) {
  return (
    <div className="border border-green-900 rounded bg-black/90 p-5 flex flex-col min-h-[150px] shadow-[inset_0_0_10px_rgba(0,0,0,0.8)] font-mono">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-green-950/80 text-[10px] flex-shrink-0">
        <span className="flex items-center gap-1.5 text-white">
          <Terminal className="w-4 h-4 text-green-400" /> SYSTEM DIAGNOSTIC TELEMETRY LOGS
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-1.5 text-[10px] leading-relaxed max-h-[150px] pr-2">
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
    </div>
  );
});
