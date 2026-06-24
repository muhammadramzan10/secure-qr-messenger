"use client";

import React, { useState, useEffect, useRef, memo } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  bufToBase64, 
  importPublicKey, 
  importPrivateKey, 
  decryptAsymmetric, 
  generateAsymmetricKeyPair, 
  exportPublicKey, 
  exportPrivateKey 
} from "@/lib/crypto";
import { 
  ShieldAlert, 
  Terminal, 
  Lock, 
  Key, 
  Send, 
  ArrowLeft, 
  Loader, 
  Search, 
  User, 
  RefreshCw, 
  Check, 
  FileText,
  Activity,
  AlertTriangle,
  LockKeyholeOpen
} from "lucide-react";
import Link from "next/link";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  public_key?: string;
  private_key_encrypted?: string;
  salt?: string;
  iv?: string;
  auth_tag?: string;
}

interface Message {
  id: string;
  user_id: string;
  recipient_id: string;
  cipher_text: string;
  salt: string;
  iv: string;
  auth_tag: string;
  encrypted_aes_key: string;
  created_at: string;
  decryptedText?: string;
  decryptionError?: boolean;
}

const ChatConsole = memo(function ChatConsole({ logs }: { logs: { time: string; text: string }[] }) {
  return (
    <div className="lg:col-span-3 border border-green-900 rounded bg-black/90 p-3 md:p-4 flex flex-col h-[300px] lg:h-[650px] shadow-[inset_0_0_12px_rgba(0,0,0,0.85)]">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-green-950/80 text-[10px] flex-shrink-0">
        <span className="flex items-center gap-1.5 text-white font-bold uppercase">
          <Terminal className="w-3.5 h-3.5 text-green-400 animate-pulse" /> TELEMETRY OUTPUT
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 text-[10px] leading-relaxed font-mono">
        {logs.map((log, index) => (
          <div key={index} className="flex gap-1">
            <span className="text-green-700 flex-shrink-0">[{log.time}]</span>
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

      <div className="border-t border-green-950 mt-3 pt-3 text-[9px] text-green-800 text-center flex-shrink-0">
        NODE SECURITY PROFILE: RSA-OAEP-2048
      </div>
    </div>
  );
});

export default function ChatPage() {
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Auth & Keys states
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [unlockedPrivateKey, setUnlockedPrivateKey] = useState<CryptoKey | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Recovery / Key provisioning state for unkeyed profiles
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionPassword, setProvisionPassword] = useState("");
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Directory & Selection states
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<Profile | null>(null);
  
  // Message Grid states
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  
  // UI logging feed
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"directory" | "chat">("directory");

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text
  });

  // Initialize page, get user session and profile details
  useEffect(() => {
    setLogs([
      createLog("Secure Direct Messaging"),
      createLog("[*] Checking your login status...")
    ]);
    checkAuthAndLoadProfile();
  }, []);

  const checkAuthAndLoadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        setLogs((prev) => [...prev, createLog(`[+] Logged in as: ${user.email}`)]);
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
          
        if (!error && data) {
          setProfile(data);
          if (data.public_key && data.private_key_encrypted) {
            setLogs((prev) => [...prev, createLog("[+] Encryption keys found. Enter your password to unlock.")]);
          } else {
            setLogs((prev) => [...prev, createLog("[!] No encryption keys yet. You need to set up your keys first.")]);
          }
        }
      } else {
        setLogs((prev) => [...prev, createLog("[-] Not logged in. Please sign in to use chat.")]);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Error checking login: ${err.message}`)]);
    } finally {
      setLoadingProfile(false);
    }
  };

  // Recover / Provision keys if user is unkeyed (e.g. registered with custom setup)
  const handleProvisionKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !provisionPassword) return;

    setProvisionLoading(true);
    setProvisionError(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Generating your encryption keys..."),
      createLog("[*] Creating a secure key pair...")
    ]);

    try {
      // 1. Generate new asymmetric keypair
      const keypair = await generateAsymmetricKeyPair();
      setLogs((prev) => [...prev, createLog("[+] Key pair created successfully.")]);

      // 2. Export public key as JWK string
      const pubKeyString = await exportPublicKey(keypair.publicKey);
      setLogs((prev) => [...prev, createLog("[*] Preparing your public key...")]);

      // 3. Encrypt and export private key using password
      setLogs((prev) => [...prev, createLog("[*] Encrypting your private key with your password...")]);
      const encPrivateKey = await exportPrivateKey(keypair.privateKey, provisionPassword);
      setLogs((prev) => [...prev, createLog("[+] Private key protected successfully.")]);

      // 4. Update profiles table
      setLogs((prev) => [...prev, createLog("[*] Saving keys to your profile...")]);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          public_key: pubKeyString,
          private_key_encrypted: encPrivateKey.encryptedPrivateKey,
          salt: encPrivateKey.salt,
          iv: encPrivateKey.iv,
          auth_tag: encPrivateKey.authTag,
        })
        .eq("id", user.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      setLogs((prev) => [...prev, createLog("[+] Keys set up successfully! Loading your profile...")]);
      
      // Reload profile
      await checkAuthAndLoadProfile();
    } catch (err: any) {
      setProvisionError(err.message || "Failed to provision keys.");
      setLogs((prev) => [...prev, createLog(`[-] Key setup failed: ${err.message}`)]);
    } finally {
      setProvisionLoading(false);
    }
  };

  // Unlock private key in client-side RAM
  const handleUnlockPrivateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !unlockPassword) return;

    setUnlockLoading(true);
    setUnlockError(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Loading your encrypted private key..."),
      createLog("[*] Generating unlock key from your password...")
    ]);

    try {
      const privKey = await importPrivateKey(
        profile.private_key_encrypted!,
        profile.salt!,
        profile.iv!,
        profile.auth_tag!,
        unlockPassword
      );

      setLogs((prev) => [
        ...prev,
        createLog("[+] Password accepted. Key unlocked."),
        createLog("[+] Your private key is now active in this session.")
      ]);

      setUnlockedPrivateKey(privKey);
      
      // Once unlocked, load profiles directory
      fetchProfiles();
    } catch (err: any) {
      setUnlockError("Incorrect password. Unable to unlock your chat keys.");
      setLogs((prev) => [
        ...prev, 
        createLog(`[-] Could not unlock: ${err.message}`),
        createLog("[-] Wrong password. Please try again.")
      ]);
    } finally {
      setUnlockLoading(false);
    }
  };

  // Fetch registered profiles for directory sidebar
  const fetchProfiles = async () => {
    if (!user) return;
    setLogs((prev) => [...prev, createLog("[*] Loading contacts...")]);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, public_key")
        .neq("id", user.id);

      if (error) throw error;

      setProfiles(data || []);
      setLogs((prev) => [...prev, createLog(`[+] Found ${data?.length || 0} contacts.`)]);
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Could not load contacts: ${err.message}`)]);
    }
  };

  // Load and decrypt messages for active conversation
  const fetchMessages = async () => {
    if (!user || !selectedPartner || !unlockedPrivateKey) return;

    setMessagesLoading(true);
    try {
      // Fetch messages between user and active partner
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(user_id.eq.${user.id},recipient_id.eq.${selectedPartner.id}),and(user_id.eq.${selectedPartner.id},recipient_id.eq.${user.id})`)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Decrypt messages client-side
      const decryptedList = await Promise.all(
        (data || []).map(async (msg: Message) => {
          // Verify if it contains E2E key material
          if (msg.encrypted_aes_key) {
            try {
              let keyToUse = "";
              
              // Check if encrypted_aes_key is a JSON containing sender/recipient keys
              if (msg.encrypted_aes_key.trim().startsWith("{")) {
                const keysJSON = JSON.parse(msg.encrypted_aes_key);
                if (msg.user_id === user.id) {
                  // Current user is the sender
                  keyToUse = keysJSON.sender;
                } else {
                  // Current user is the recipient
                  keyToUse = keysJSON.recipient;
                }
              } else {
                // Legacy message, fallback to default encrypted_aes_key (assuming recipient)
                keyToUse = msg.encrypted_aes_key;
              }

              if (!keyToUse) {
                return { ...msg, decryptedText: "[ LOCKED — Encrypted for recipient only ]", decryptionError: true };
              }

              const decrypted = await decryptAsymmetric(
                unlockedPrivateKey,
                msg.cipher_text,
                keyToUse,
                msg.iv,
                msg.auth_tag
              );

              return { ...msg, decryptedText: decrypted };
            } catch (err) {
              return { ...msg, decryptedText: "[ LOCKED — Key derivation mismatch / Tampered ]", decryptionError: true };
            }
          } else {
            // Not a direct asymmetric message (e.g. public QR message)
            return { ...msg, decryptedText: "[ SYMMETRIC PACKET — Read via scans only ]", decryptionError: true };
          }
        })
      );

      setMessages(decryptedList);
      scrollToBottom();
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Could not load messages: ${err.message}`)]);
    } finally {
      setMessagesLoading(false);
    }
  };

  // Trigger message load when selected partner changes
  useEffect(() => {
    if (selectedPartner) {
      setLogs((prev) => [...prev, createLog(`[*] Opening chat with ${selectedPartner.full_name || selectedPartner.email}...`)]);
      fetchMessages();
      setActiveTab("chat");
    }
  }, [selectedPartner]);

  // Set up real-time subscription for new messages
  useEffect(() => {
    if (!user || !selectedPartner || !unlockedPrivateKey) return;

    setLogs((prev) => [...prev, createLog("[*] Connecting to live updates...")]);
    
    const channel = supabase
      .channel(`realtime_chat_${selectedPartner.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const newMsg = payload.new;
          // Verify if new message belongs to the active conversation
          if (
            (newMsg.user_id === user.id && newMsg.recipient_id === selectedPartner.id) ||
            (newMsg.user_id === selectedPartner.id && newMsg.recipient_id === user.id)
          ) {
            setLogs((prev) => [...prev, createLog("[+] New message received! Refreshing chat...")]);
            fetchMessages();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeConnected(true);
          setLogs((prev) => [...prev, createLog("[+] Live updates connected.")]);
        } else {
          setRealtimeConnected(false);
        }
      });

    return () => {
      setLogs((prev) => [...prev, createLog("[*] Disconnecting live updates...")]);
      supabase.removeChannel(channel);
    };
  }, [selectedPartner, unlockedPrivateKey]);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // Send asymmetric encrypted message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedPartner || !profile || sendLoading) return;

    if (!selectedPartner.public_key) {
      setLogs((prev) => [...prev, createLog("[-] Can't send: This contact hasn't set up their encryption keys yet.")]);
      return;
    }

    setSendLoading(true);
    setLogs((prev) => [...prev, createLog("[*] Encrypting and sending message...")]);

    try {
      // Import public keys
      const recipientPubKey = await importPublicKey(selectedPartner.public_key);
      const senderPubKey = await importPublicKey(profile.public_key!);

      // 1. Generate random ephemeral symmetric key (32 bytes)
      const aesKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBytes,
        "AES-GCM",
        true,
        ["encrypt"]
      );

      // 2. Encrypt text with ephemeral AES key
      const ivBytes = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const ciphered = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: ivBytes as BufferSource },
        aesKey,
        encoder.encode(newMessage.trim())
      );

      const cipherArr = new Uint8Array(ciphered);
      const cipherBody = cipherArr.slice(0, -16);
      const authTagBytes = cipherArr.slice(-16);

      // 3. Encrypt ephemeral AES key for recipient
      const encKeyRecipientBuf = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        recipientPubKey,
        aesKeyBytes as BufferSource
      );

      // 4. Encrypt ephemeral AES key for sender (so sender can decrypt and read history)
      const encKeySenderBuf = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        senderPubKey,
        aesKeyBytes as BufferSource
      );

      // 5. Build dual-role key object
      const dualRoleKeysJSON = JSON.stringify({
        recipient: bufToBase64(new Uint8Array(encKeyRecipientBuf)),
        sender: bufToBase64(new Uint8Array(encKeySenderBuf))
      });

      // 6. Transmit to Supabase
      setLogs((prev) => [...prev, createLog("[*] Uploading encrypted message...")]);
      
      const { error: sendError } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          recipient_id: selectedPartner.id,
          cipher_text: bufToBase64(cipherBody),
          salt: "E2E_ASYMMETRIC", // dummy value for schema constraint
          iv: bufToBase64(ivBytes),
          auth_tag: bufToBase64(authTagBytes),
          encrypted_aes_key: dualRoleKeysJSON,
          is_one_time: false,
          self_destruct: false,
          is_active: true,
          is_used: false
        });

      if (sendError) throw sendError;

      setLogs((prev) => [...prev, createLog("[+] Message sent successfully!")]);
      setNewMessage("");
      fetchMessages();

    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Failed to send: ${err.message}`)]);
    } finally {
      setSendLoading(false);
    }
  };

  // Filter profiles based on search
  const filteredProfiles = profiles.filter((p) => {
    const term = searchQuery.toLowerCase();
    return (
      (p.full_name && p.full_name.toLowerCase().includes(term)) ||
      (p.email && p.email.toLowerCase().includes(term))
    );
  });

  return (
    <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono relative overflow-hidden select-none selection:bg-green-500 selection:text-black">
      {/* Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,16,16,0)+50%,rgba(0,0,0,0.25)+50%),linear-gradient(to_right,rgba(255,0,0,0.06)+33%,rgba(0,255,0,0.02)+33%,rgba(0,0,255,0.06)+66%)] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

      {/* Header */}
      <header className="border-b border-green-950 bg-black/80 backdrop-blur-md sticky top-0 z-20 py-4 px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-xs text-green-700 hover:text-green-400 transition-all duration-300">
          <ArrowLeft className="w-4 h-4" /> [ BACK TO COMMAND GRID ]
        </Link>
        <div className="flex items-center gap-3 text-xs">
          {realtimeConnected && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-emerald-950 bg-emerald-950/20 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>REALTIME SYNC ACTIVE</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1 rounded border border-green-900 bg-green-950/20 text-xs">
            <span>ASYMMETRIC DIRECT LINE</span>
          </div>
        </div>
      </header>

      {/* Loading main container */}
      {loadingProfile ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader className="w-8 h-8 text-green-400 animate-spin" />
          <span className="text-xs tracking-widest uppercase animate-pulse">Syncing Cryptographic Grid Status...</span>
        </div>
      ) : !user ? (
        /* ACCESS DENIED GUEST */
        <main className="flex-1 flex items-center justify-center p-6 z-20">
          <div className="w-full max-w-md border border-red-950 bg-zinc-950/90 rounded p-8 text-center space-y-6 shadow-[0_0_25px_rgba(239,68,68,0.02)]">
            <ShieldAlert className="w-12 h-12 text-red-500 mx-auto animate-pulse" />
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white uppercase tracking-wider">Secure Chat Locked</h2>
              <p className="text-xs text-red-400 leading-relaxed">
                Direct end-to-end messaging is only available to logged-in users. Please log in or sign up first.
              </p>
            </div>
            <div className="pt-2">
              <Link 
                href="/login"
                className="inline-block px-6 py-2.5 border border-green-500 hover:bg-green-500 hover:text-black transition-all duration-300 text-xs font-bold rounded"
              >
                LOG IN TO YOUR ACCOUNT
              </Link>
            </div>
          </div>
        </main>
      ) : !profile?.public_key || !profile?.private_key_encrypted ? (
        /* PROVISION KEYPAIR UI FOR UNKEYED PROFILES */
        <main className="flex-1 flex items-center justify-center p-6 z-20">
          <div className="w-full max-w-md border border-yellow-950 bg-zinc-950/90 rounded p-8 space-y-6 shadow-[0_0_20px_rgba(234,179,8,0.02)]">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto animate-pulse mb-3" />
              <h2 className="text-lg font-bold text-white uppercase tracking-wider">First-Time Setup</h2>
              <p className="text-xs text-yellow-500/80 mt-1 leading-relaxed">
                To start messaging, we need to generate your secure encryption keypair. Enter a password below to protect your private key locally.
              </p>
            </div>

            <form onSubmit={handleProvisionKeys} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-green-700 font-bold block uppercase">PASSWORD (SEALS PRIVATE KEY)</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                  <input
                    type="password"
                    required
                    placeholder="Enter password to seal private key..."
                    value={provisionPassword}
                    onChange={(e) => setProvisionPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-yellow-950 bg-black/60 text-sm text-yellow-500 placeholder:text-yellow-900 outline-none rounded font-mono"
                  />
                </div>
                <p className="text-[10px] text-yellow-600 leading-tight">
                  * This password is used to encrypt your private key client-side. The plain key is never sent to the server.
                </p>
              </div>

              {provisionError && (
                <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded">
                  [!] PROVISION ERROR: {provisionError}
                </div>
              )}

              <button
                type="submit"
                disabled={provisionLoading}
                className="w-full py-2.5 border border-yellow-500 bg-yellow-500/10 hover:bg-yellow-500 hover:text-black transition-all duration-300 font-bold text-xs uppercase rounded flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {provisionLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    GENERATING SECURED CODES...
                  </>
                ) : (
                  "PROVISION NODE CRYPTO KEYS"
                )}
              </button>
            </form>
          </div>
        </main>
      ) : !unlockedPrivateKey ? (
        /* UNLOCK KEY DECK SCREEN */
        <main className="flex-1 flex items-center justify-center p-6 z-20">
          <div className="w-full max-w-md border border-green-900 bg-zinc-950/90 rounded p-8 space-y-6 shadow-[0_0_20px_rgba(34,197,94,0.03)]">
            <div className="text-center">
              <Lock className="w-12 h-12 text-green-400 mx-auto animate-pulse mb-3" />
              <h2 className="text-lg font-bold text-white uppercase tracking-widest">Unlock Secure Chat</h2>
              <p className="text-xs text-green-700 mt-1 leading-relaxed">
                Enter your password to load your private key and access your direct messages. Your key never leaves this browser.
              </p>
            </div>

            <form onSubmit={handleUnlockPrivateKey} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-green-700 font-bold block uppercase">PASSPHRASE KEY</label>
                <div className="relative">
                  <Key className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                  <input
                    type="password"
                    required
                    placeholder="Enter passcode credentials..."
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-green-950 bg-black/60 text-sm text-green-400 placeholder:text-green-900 outline-none rounded font-mono"
                  />
                </div>
              </div>

              {unlockError && (
                <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded">
                  [!] {unlockError}
                </div>
              )}

              <button
                type="submit"
                disabled={unlockLoading}
                className="w-full py-2.5 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black transition-all duration-300 font-bold text-xs uppercase rounded flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {unlockLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    DECRYPTING KEY SCHEMES...
                  </>
                ) : (
                  "AUTHENTICATE & DECRYPT GRID"
                )}
              </button>
            </form>
          </div>
        </main>
      ) : (
        /* MAIN CHAT INTERFACE */
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 z-20 min-h-[500px] flex flex-col gap-6">
          
          {/* Mobile Tab Toggle */}
          <div className="flex lg:hidden border border-green-900 rounded bg-zinc-950/90 overflow-hidden">
            <button
              onClick={() => setActiveTab("directory")}
              className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "directory"
                  ? "bg-green-500/10 text-green-400 border-b-2 border-green-500"
                  : "text-green-700 hover:text-green-500"
              }`}
            >
              <User className="w-3.5 h-3.5" /> DIRECTORY
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "chat"
                  ? "bg-green-500/10 text-green-400 border-b-2 border-green-500"
                  : "text-green-700 hover:text-green-500"
              }`}
            >
              <Send className="w-3.5 h-3.5" /> CHAT
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          
          {/* LEFT COLUMN: Sidebar Nodes (4 cols) */}
          <div className={`lg:col-span-4 border border-green-900 rounded bg-zinc-950/90 flex flex-col h-[500px] lg:h-[650px] ${activeTab !== "directory" ? "hidden lg:flex" : "flex"}`}>
            {/* Sidebar search header */}
            <div className="p-4 border-b border-green-950 space-y-3 flex-shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-green-400" /> GRID PROFILE NODES
              </h3>
              <div className="relative">
                <Search className="absolute left-3 top-3 w-4 h-4 text-green-800" />
                <input
                  type="text"
                  placeholder="Filter nodes by identity..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-green-950 bg-black/60 text-xs text-green-400 placeholder:text-green-900 outline-none rounded font-mono"
                />
              </div>
            </div>

            {/* Sidebar profile list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredProfiles.length > 0 ? (
                filteredProfiles.map((p) => {
                  const isSelected = selectedPartner?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPartner(p)}
                      className={`p-3 rounded border transition-all duration-200 cursor-pointer ${
                        isSelected 
                          ? "border-green-500 bg-green-500/10 text-white shadow-[0_0_10px_rgba(34,197,94,0.05)]" 
                          : "border-transparent hover:border-green-950 hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-bold truncate max-w-[170px]">{p.full_name || "Anonymous Node"}</span>
                        {p.public_key ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-900 bg-emerald-950/20 text-emerald-400 font-bold tracking-wider">
                            SECURED
                          </span>
                        ) : (
                          <span className="text-[8px] px-1.5 py-0.5 rounded border border-yellow-950 bg-yellow-950/20 text-yellow-500 font-bold tracking-wider animate-pulse">
                            UNKEYED
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-green-700 truncate mt-1">{p.email}</p>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 text-xs text-green-800 font-mono">
                  No other nodes discovered in range.
                </div>
              )}
            </div>
            
            {/* Sidebar telemetry preview */}
            <div className="p-3 border-t border-green-950 bg-black/50 text-[10px] text-green-800 flex-shrink-0 flex items-center justify-between">
              <span>UNLOCKED NODE: {profile?.email?.substring(0, 15)}...</span>
              <button 
                onClick={fetchProfiles}
                className="hover:text-green-400 transition-colors"
                title="Refresh user profiles directory"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* MIDDLE COLUMN: Chat Window (5 cols) */}
          <div className={`lg:col-span-5 border border-green-900 rounded bg-zinc-950/90 flex flex-col h-[500px] lg:h-[650px] relative ${activeTab !== "chat" ? "hidden lg:flex" : "flex"}`}>
            
            {selectedPartner ? (
              <>
                {/* Chat Partner Header */}
                <div className="p-3 md:p-4 border-b border-green-950 bg-black/40 flex-shrink-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setActiveTab("directory")}
                      className="lg:hidden p-1.5 border border-green-900 rounded hover:border-green-500 text-green-600 hover:text-green-400 transition-all cursor-pointer flex-shrink-0"
                      title="Back to directory"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <div className="min-w-0">
                    <h3 className="text-xs font-bold text-white uppercase">{selectedPartner.full_name || "Secure Chat Partner"}</h3>
                    <p className="text-[9px] text-green-700 truncate max-w-[200px]">{selectedPartner.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={fetchMessages}
                      disabled={messagesLoading}
                      className="p-1.5 border border-green-900 rounded hover:border-green-500 text-green-600 hover:text-green-400 transition-all cursor-pointer disabled:opacity-50"
                      title="Sync message logs manually"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${messagesLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* Message display thread */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[480px]">
                  {messagesLoading && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-2 text-xs text-green-700 animate-pulse">
                      <Loader className="w-4 h-4 animate-spin text-green-500" />
                      SYNCHRONIZING SECURE MESSAGES...
                    </div>
                  ) : messages.length > 0 ? (
                    messages.map((msg) => {
                      const isMe = msg.user_id === user.id;
                      return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[85%] ${isMe ? "ml-auto" : "mr-auto"}`}>
                          
                          {/* Sender Identity */}
                          <span className="text-[9px] text-green-800 mb-1 select-none font-bold uppercase">
                            {isMe ? "LOCAL NODE" : selectedPartner.full_name || "PARTNER NODE"}
                          </span>

                          {/* Message Body */}
                          <div className={`p-3 rounded text-xs leading-relaxed break-words font-mono ${
                            isMe 
                              ? "bg-green-950/20 border border-green-500 text-green-400 shadow-[inset_0_0_10px_rgba(0,255,0,0.04)]" 
                              : "bg-zinc-900/90 border border-green-950 text-white"
                          }`}>
                            {msg.decryptedText}
                          </div>

                          {/* Timestamp */}
                          <span className="text-[8px] text-green-800 mt-1 select-none">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-24 text-xs text-green-700 italic border border-dashed border-green-950/50 rounded p-6 m-4">
                      No encrypted coordinate messages exchanged. Feed is cleared.
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Send message text input */}
                <div className="p-4 border-t border-green-950 bg-black/20 flex-shrink-0">
                  {!selectedPartner.public_key ? (
                    <div className="text-[10px] border border-yellow-950 bg-yellow-950/10 p-3 rounded text-yellow-500 text-center flex items-center justify-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> RECIPIENT NODE UNKEYED. SEND DISABLED.
                    </div>
                  ) : (
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                      <input
                        type="text"
                        required
                        placeholder="Transmit secure coordinates..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="flex-1 px-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-xs text-green-400 placeholder:text-green-900 outline-none rounded font-mono"
                      />
                      <button
                        type="submit"
                        disabled={sendLoading || !newMessage.trim()}
                        className="px-4 py-2.5 border border-green-500 hover:bg-green-500 hover:text-black font-bold text-xs uppercase transition-all duration-300 rounded flex-shrink-0 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {sendLoading ? <Loader className="w-4.5 h-4.5 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </form>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-green-800">
                <LockKeyholeOpen className="w-12 h-12 mb-3 text-green-900 animate-pulse" />
                <h3 className="text-xs uppercase font-bold tracking-wider text-green-600">Select active communications node</h3>
                <p className="text-[10px] text-green-800 max-w-xs mt-2 leading-relaxed">
                  Choose a peer node from the left directory sidebar. Secure keys will be derived to establish an E2E tunnel link.
                </p>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Chat Telemetry Logger (3 cols) */}
          <ChatConsole logs={logs} />

          </div>
        </main>
      )}

      {/* Footer */}
      <footer className="border-t border-green-950 py-4 px-6 md:px-12 text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] text-green-800 bg-black/90 z-20">
        <div>
          <span>OPERATIONAL STATUS: NOMINAL</span>
          <span className="mx-2">|</span>
          <span>LOCATION ENCRYPTION NODE: LOCALHOST</span>
        </div>
        <div>
          <span>© 2026 SECURE QR CRYPTO MESSENGER. FREE STAGING SENDING GRID.</span>
        </div>
      </footer>
    </div>
  );
}
