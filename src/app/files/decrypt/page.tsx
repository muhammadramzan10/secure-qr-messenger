"use client";

import React, { useState, useEffect, Suspense, memo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { 
  base64ToBuf, 
  deriveKeyFromPassword 
} from "@/lib/crypto";
import { 
  ShieldAlert, 
  Terminal, 
  Lock, 
  Key, 
  Download, 
  ArrowLeft, 
  Loader, 
  AlertTriangle,
  File,
  CheckCircle,
  FileCheck
} from "lucide-react";
import Link from "next/link";

interface FileMetadata {
  id: string;
  storage_path: string;
  file_name_encrypted: string;
  file_name_iv: string;
  file_name_auth_tag: string;
  mime_type_encrypted: string;
  mime_type_iv: string;
  mime_type_auth_tag: string;
  file_size: number;
  salt: string;
  file_iv: string;
  file_auth_tag: string;
}

const FileDecryptConsole = memo(function FileDecryptConsole({ logs }: { logs: { time: string; text: string }[] }) {
  return (
    <div className="border border-green-900 rounded bg-black/90 p-4 md:p-6 flex-1 flex flex-col shadow-[inset_0_0_15px_rgba(0,0,0,0.85)]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-green-950/80 text-xs">
        <span className="flex items-center gap-2 text-white">
          <Terminal className="w-4 h-4 text-green-400" /> PIPELINE DATA STREAM
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 text-[11px] leading-relaxed max-h-[300px] lg:max-h-none font-mono">
        {logs.map((log, index) => (
          <div key={index} className="flex gap-2">
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

      <div className="border-t border-green-950 mt-4 pt-4 text-[10px] text-green-800 text-center">
        DECRYPTION GRID NODE
      </div>
    </div>
  );
});

function FileDecryptContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const urlToken = searchParams.get("token") || "";

  // Stepper states
  // 1 = Locate File record / Enter token
  // 2 = Password Unlock file download
  // 3 = Success Downloaded
  const [step, setStep] = useState(urlToken ? 1 : 1);
  const [tokenInput, setTokenInput] = useState(urlToken);
  const [activeToken, setActiveToken] = useState(urlToken);

  // Loading & Error states
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Data states
  const [fileRecord, setFileRecord] = useState<FileMetadata | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [decryptedFilename, setDecryptedFilename] = useState("");
  
  // Console logs feed
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text
  });

  useEffect(() => {
    setLogs([
      createLog("Secure File Download"),
      createLog("[*] Paste your file link or token to get started...")
    ]);
  }, []);

  useEffect(() => {
    if (urlToken) {
      setActiveToken(urlToken);
      setTokenInput(urlToken);
      setLogs((prev) => [...prev, createLog(`[*] File token found in URL: ${urlToken}`)]);
    }
  }, [urlToken]);

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
    setLogs((prev) => [...prev, createLog(`[*] Token entered: ${extractedToken}`)]);
  };

  // Step 1: Handshake with Supabase to download SQL record
  const handleRetrieveMetadata = async () => {
    if (!activeToken) return;

    setLoading(true);
    setErrorMsg(null);
    setLogs((prev) => [
      ...prev,
      createLog(`[*] Looking up file for token: ${activeToken}...`)
    ]);

    try {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("file_token", activeToken)
        .single();

      if (error || !data) {
        throw new Error("Target encrypted file coordinates not found on grid ledger.");
      }

      setLogs((prev) => [
        ...prev,
        createLog("[+] File found! Details loaded."),
        createLog(`    - Size: ${(data.file_size / 1024).toFixed(1)} KB`),
        createLog("[*] Enter your password to download and decrypt...")
      ]);

      setFileRecord(data);
      setStep(2);
    } catch (err: any) {
      setErrorMsg("This file link is invalid, has expired, or has been deleted.");
      setLogs((prev) => [...prev, createLog(`[-] Could not find file: ${err.message}`)]);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Download the encrypted blob and decrypt client-side
  const handleDecryptAndDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileRecord || !passphrase) return;

    setDecrypting(true);
    setErrorMsg(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Downloading encrypted file from cloud..."),
      createLog(`[*] File location: ${fileRecord.storage_path}`)
    ]);

    try {
      // 1. Download the encrypted Blob
      const { data: blobData, error: storageError } = await supabase.storage
        .from("encrypted_files")
        .download(fileRecord.storage_path);

      if (storageError || !blobData) {
        throw new Error(`Failed to download storage artifact: ${storageError?.message}`);
      }

      setLogs((prev) => [...prev, createLog("[+] Encrypted file downloaded.")]);

      // 2. Derive key from passcode using the stored salt
      setLogs((prev) => [...prev, createLog("[*] Generating decryption key from your password...")]);
      const saltBytes = base64ToBuf(fileRecord.salt);
      const key = await deriveKeyFromPassword(passphrase, saltBytes);

      // 3. Decrypt the filename and MIME type
      setLogs((prev) => [...prev, createLog("[*] Decrypting file details...")]);
      const textDecoder = new TextDecoder();

      // Decrypt Filename
      const filenameBytes = base64ToBuf(fileRecord.file_name_encrypted);
      const filenameTag = base64ToBuf(fileRecord.file_name_auth_tag);
      const filenameIv = base64ToBuf(fileRecord.file_name_iv);

      const combinedFilename = new Uint8Array(filenameBytes.length + filenameTag.length);
      combinedFilename.set(filenameBytes);
      combinedFilename.set(filenameTag, filenameBytes.length);

      const decryptedFilenameBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: filenameIv as BufferSource },
        key,
        combinedFilename as BufferSource
      );
      const filename = textDecoder.decode(decryptedFilenameBuf);

      // Decrypt MIME type
      const mimeBytes = base64ToBuf(fileRecord.mime_type_encrypted);
      const mimeTag = base64ToBuf(fileRecord.mime_type_auth_tag);
      const mimeIv = base64ToBuf(fileRecord.mime_type_iv);

      const combinedMime = new Uint8Array(mimeBytes.length + mimeTag.length);
      combinedMime.set(mimeBytes);
      combinedMime.set(mimeTag, mimeBytes.length);

      const decryptedMimeBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: mimeIv as BufferSource },
        key,
        combinedMime as BufferSource
      );
      const mime = textDecoder.decode(decryptedMimeBuf);

      setLogs((prev) => [
        ...prev,
        createLog("[+] File details decrypted:"),
        createLog(`    - Name: ${filename}`),
        createLog(`    - Type: ${mime}`)
      ]);

      // 4. Decrypt raw file body
      setLogs((prev) => [...prev, createLog("[*] Decrypting file contents...")]);
      const fileArrayBuffer = await blobData.arrayBuffer();
      
      const decryptedFileBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBuf(fileRecord.file_iv) as BufferSource },
        key,
        fileArrayBuffer as BufferSource
      );

      setLogs((prev) => [...prev, createLog("[+] File decrypted successfully! Preparing download...")]);

      // 5. Build Blob and trigger browser download save prompt
      const plainBlob = new Blob([decryptedFileBuffer], { type: mime });
      const downloadUrl = URL.createObjectURL(plainBlob);
      
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      setDecryptedFilename(filename);
      setLogs((prev) => [
        ...prev,
        createLog(`[+] Download started: ${filename}`),
        createLog("[!] All done! Your file has been saved.")
      ]);

      setStep(3);

    } catch (err: any) {
      setErrorMsg("Incorrect password. The file could not be decrypted.");
      setLogs((prev) => [...prev, createLog(`[-] Decryption failed: Wrong password or corrupted file.`)]);
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono relative overflow-hidden select-none selection:bg-green-500 selection:text-black">
      {/* Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,16,16,0)+50%,rgba(0,0,0,0.25)+50%),linear-gradient(to_right,rgba(255,0,0,0.06)+33%,rgba(0,255,0,0.02)+33%,rgba(0,0,255,0.06)+66%)] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

      {/* Header */}
      <header className="border-b border-green-950 bg-black/80 backdrop-blur-md sticky top-0 z-20 py-4 px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-xs text-green-700 hover:text-green-400 transition-all duration-300">
          <ArrowLeft className="w-4 h-4" /> [ BACK TO COMMAND GRID ]
        </Link>
        <div className="flex items-center gap-2 px-3 py-1 rounded border border-green-900 bg-green-950/20 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>DECRYPT DECK GATEWAY</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 z-20">
        
        {/* Left Column: Decryption Form / States */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-green-900 rounded bg-zinc-950/90 p-6 md:p-8 shadow-[0_0_20px_rgba(0,255,0,0.02)]">
            
            <div className="flex items-center gap-3 mb-6">
              <div className="relative">
                <File className="w-8 h-8 text-green-400 animate-pulse" />
                <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-wider">DECRYPT STORAGE FILE</h2>
                <p className="text-xs text-green-700">AES-GCM-256 ZERO-KNOWLEDGE BINARY DECODER</p>
              </div>
            </div>

            {errorMsg && step === 1 && (
              <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-4 rounded leading-relaxed mb-6 font-mono">
                [!] SYSTEM EXCEPTION:
                <p className="mt-1 text-red-500 font-bold">{errorMsg}</p>
              </div>
            )}

            {/* STEP 1: Input token / Handshake */}
            {step === 1 && (
              <div className="space-y-6">
                <form onSubmit={handleTokenSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-green-700 font-bold block uppercase">
                      FILE SECURITY TOKEN OR URL
                    </label>
                    <input
                      type="text"
                      placeholder="Paste the file decrypt link or token value here..."
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
                      COMMIT TOKEN
                    </button>
                  )}
                </form>

                {activeToken ? (
                  <div className="border border-green-950 bg-green-950/5 p-6 rounded space-y-4">
                    <div className="space-y-1 text-xs">
                      <h4 className="text-sm font-bold text-white uppercase">ENCRYPTED COGNITIVE PACKAGE MOUNTED</h4>
                      <p className="text-green-700 leading-relaxed">
                        Ready to request coordinate handshake for token: <code className="text-green-500 bg-green-950/30 px-1.5 py-0.5 rounded">{activeToken.substring(0, 10)}...</code>.
                      </p>
                    </div>

                    <button
                      onClick={handleRetrieveMetadata}
                      disabled={loading}
                      className="w-full py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded shadow-[0_0_15px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          VERIFYING HANDSHAKE DECK...
                        </>
                      ) : (
                        "RETRIEVE SECURE FILE METADATA"
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="border border-green-950 bg-green-950/5 p-6 rounded text-center text-xs text-green-700">
                    Provide an active file token or drag-and-drop link above to initialize the decryption interface.
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Input passcode for decrypt */}
            {step === 2 && fileRecord && (
              <form onSubmit={handleDecryptAndDownload} className="space-y-6">
                <div className="border border-green-950 bg-green-950/5 p-4 rounded text-xs space-y-2">
                  <div className="font-bold text-white uppercase">FILE SPECIFICATION METADATA:</div>
                  <ul className="space-y-1 text-green-700">
                    <li>• ENCRYPTED PAYLOAD ID: <span className="text-green-500">{activeToken.substring(0, 15)}...</span></li>
                    <li>• PUBLIC SIZE: <span className="text-green-500">{(fileRecord.file_size / 1024).toFixed(1)} KB</span></li>
                    <li>• ENCRYPTED TARGET STORAGE: <span className="text-green-500 truncate max-w-[200px] inline-block align-bottom">{fileRecord.storage_path}</span></li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold block uppercase flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> ENTER FILE SECURITY PASSCODE
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                    <input
                      type="password"
                      required
                      placeholder="Enter the passphrase to download and decrypt file..."
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed font-mono">
                    [!] ERROR: {errorMsg}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={decrypting || !passphrase}
                    className="py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {decrypting ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        DECRYPTING BINARIES...
                      </>
                    ) : (
                      "DECRYPT & DOWNLOAD"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setFileRecord(null);
                      setPassphrase("");
                      setLogs((prev) => [...prev, createLog("[*] Went back. Data cleared.")]);
                    }}
                    className="py-3 border border-green-950 hover:border-green-500 text-green-700 hover:text-green-400 font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded flex items-center justify-center gap-2 cursor-pointer"
                  >
                    ABORT HANDSHAKE
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: Decrypted success download details */}
            {step === 3 && (
              <div className="space-y-6 animate-fadeIn">
                <div className="border border-green-500 bg-green-950/10 p-4 rounded flex items-center gap-3 text-xs text-green-400">
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <span className="font-bold text-white uppercase">DECRYPTION SUCCESSFUL:</span> Binary integrity check matched. File envelope successfully resolved.
                  </div>
                </div>

                <div className="border border-green-950 bg-green-950/5 p-4 rounded text-xs space-y-1.5">
                  <div className="font-bold text-white uppercase flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-emerald-400" /> DECRYPTED ARTIFACT SAVED:
                  </div>
                  <div className="text-green-400 font-bold text-sm tracking-wider font-mono truncate max-w-full">
                    {decryptedFilename}
                  </div>
                </div>

                <div className="pt-2 text-center">
                  <button
                    onClick={() => {
                      setStep(1);
                      setActiveToken("");
                      setTokenInput("");
                      setFileRecord(null);
                      setPassphrase("");
                      setDecryptedFilename("");
                      setLogs((prev) => [...prev, createLog("[*] Ready to decrypt another file.")]);
                    }}
                    className="px-6 py-2.5 border border-green-500 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-wider transition-all duration-300 rounded cursor-pointer"
                  >
                    RESET FILE GATEWAY
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Right Column: Handshake logs */}
        <div className="lg:col-span-5 flex flex-col min-h-[300px] lg:h-auto gap-6">
          <FileDecryptConsole logs={logs} />
        </div>

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

export default function FileDecryptPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col min-h-screen bg-black text-green-500 font-mono items-center justify-center">
        <Loader className="w-8 h-8 text-green-400 animate-spin mb-4" />
        <span className="text-xs uppercase tracking-wider animate-pulse">Initializing File Decryption Deck...</span>
      </div>
    }>
      <FileDecryptContent />
    </Suspense>
  );
}
