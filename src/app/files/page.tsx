"use client";

import React, { useState, useEffect, memo } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  bufToBase64, 
  base64ToBuf, 
  deriveKeyFromPassword 
} from "@/lib/crypto";
import QRCode from "qrcode";
import { 
  ShieldAlert, 
  Terminal, 
  Lock, 
  Key, 
  FileUp, 
  Download, 
  ArrowLeft, 
  Loader, 
  AlertTriangle,
  File,
  Trash2,
  Copy,
  Check,
  QrCode,
  LockKeyholeOpen,
  Unlock,
  RefreshCw
} from "lucide-react";
import Link from "next/link";

interface FileRecord {
  id: string;
  user_id: string;
  storage_path: string;
  file_name_encrypted: string;
  file_name_iv: string;
  file_name_auth_tag: string;
  mime_type_encrypted: string;
  mime_type_iv: string;
  mime_type_auth_tag: string;
  file_size: number;
  salt: string;
  file_token: string;
  created_at: string;
  
  // Decrypted additions (local client state only)
  decryptedName?: string;
  decryptedMime?: string;
  decryptionError?: boolean;
}

const FilesConsole = memo(function FilesConsole({ logs }: { logs: { time: string; text: string }[] }) {
  return (
    <div className="border border-green-900 rounded bg-black/90 p-4 md:p-6 flex-1 flex flex-col shadow-[inset_0_0_15px_rgba(0,0,0,0.85)]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-green-950/80 text-xs">
        <span className="flex items-center gap-2 text-white">
          <Terminal className="w-4 h-4 text-green-400" /> VIRTUAL CONSOLE PIPELINE
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
        SECURED FILE BLOCK GRID
      </div>
    </div>
  );
});

export default function FilesPage() {
  const supabase = createClient();
  const [user, setUser] = useState<any | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Form states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // List states
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  
  // Directory unlocking passphrase
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  // UI state for share modal
  const [shareFile, setShareFile] = useState<{
    token: string;
    url: string;
    qrDataUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Console log state
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);

  const createLog = (text: string) => ({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text
  });

  useEffect(() => {
    setLogs([
      createLog("SYSTEM INITIATED — SYMMETRIC FILE PACKAGER v1.0.0"),
      createLog("[*] Fetching active node authorization...")
    ]);
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        setLogs((prev) => [...prev, createLog(`[+] Node identity verified: ${user.email}`)]);
        fetchFileList(user.id);
      } else {
        setLogs((prev) => [...prev, createLog("[!] ALERT: Unauthenticated node connection. Access Forbidden.")]);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Identity check error: ${err.message}`)]);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchFileList = async (userId: string) => {
    setListLoading(true);
    try {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Failed to fetch files ledger: ${err.message}`)]);
    } finally {
      setListLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 25 * 1024 * 1024) {
        setUploadError("File exceeds the maximum safe transmission limit of 25MB.");
        setSelectedFile(null);
      } else {
        setUploadError(null);
        setSelectedFile(file);
        setLogs((prev) => [...prev, createLog(`[*] Loaded local file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)]);
      }
    }
  };

  // Encrypt and upload file
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedFile || !passphrase) return;

    setUploadLoading(true);
    setUploadError(null);
    setLogs((prev) => [
      ...prev,
      createLog("[*] Initiating file encryption pipeline..."),
      createLog(`[*] Input size: ${selectedFile.size} bytes.`)
    ]);

    try {
      // 1. Read file to array buffer
      setLogs((prev) => [...prev, createLog("[*] Reading binary payload into buffer memory...")]);
      const fileDataBuffer = await selectedFile.arrayBuffer();

      // 2. Generate random cryptographic materials
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const fileIvBytes = crypto.getRandomValues(new Uint8Array(12));
      const filenameIvBytes = crypto.getRandomValues(new Uint8Array(12));
      const mimetypeIvBytes = crypto.getRandomValues(new Uint8Array(12));

      // 3. Derive key using PBKDF2
      setLogs((prev) => [...prev, createLog("[*] Deriving key from password (PBKDF2 SHA-256)...")]);
      const key = await deriveKeyFromPassword(passphrase, saltBytes);

      // 4. Encrypt file body (AES-GCM-256)
      setLogs((prev) => [...prev, createLog("[*] Symmetrically encrypting file buffer (AES-GCM-256)...")]);
      const encryptedFileBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: fileIvBytes as BufferSource },
        key,
        fileDataBuffer
      );
      const encFileArr = new Uint8Array(encryptedFileBuf);
      const fileBodyBytes = encFileArr.slice(0, -16);
      const fileAuthTagBytes = encFileArr.slice(-16);

      // 5. Encrypt metadata (filename, mime type) under the same key
      setLogs((prev) => [...prev, createLog("[*] Encrypting file name and mime type strings...")]);
      const encoder = new TextEncoder();
      
      const encryptedFilenameBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: filenameIvBytes as BufferSource },
        key,
        encoder.encode(selectedFile.name)
      );
      const encFilenameArr = new Uint8Array(encryptedFilenameBuf);
      const filenameBody = encFilenameArr.slice(0, -16);
      const filenameTag = encFilenameArr.slice(-16);

      const encryptedMimeBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: mimetypeIvBytes as BufferSource },
        key,
        encoder.encode(selectedFile.type || "application/octet-stream")
      );
      const encMimeArr = new Uint8Array(encryptedMimeBuf);
      const mimeBody = encMimeArr.slice(0, -16);
      const mimeTag = encMimeArr.slice(-16);

      // 6. Upload encrypted file blob to Supabase Storage
      const storageFilename = `${crypto.randomUUID()}.bin`;
      setLogs((prev) => [...prev, createLog(`[*] Transmitting encrypted blob to storage: ${storageFilename}...`)]);
      
      const fileBlob = new Blob([encFileArr], { type: "application/octet-stream" });
      const { error: storageError } = await supabase.storage
        .from("encrypted_files")
        .upload(storageFilename, fileBlob);

      if (storageError) {
        throw new Error(`Storage upload failed: ${storageError.message}`);
      }

      // 7. Register metadata inside SQL database
      const fileToken = crypto.randomUUID();
      setLogs((prev) => [...prev, createLog("[*] Saving secure metadata packet in files table...")]);
      
      const { error: dbError } = await supabase
        .from("files")
        .insert({
          user_id: user.id,
          storage_path: storageFilename,
          file_name_encrypted: bufToBase64(filenameBody),
          file_name_iv: bufToBase64(filenameIvBytes),
          file_name_auth_tag: bufToBase64(filenameTag),
          mime_type_encrypted: bufToBase64(mimeBody),
          mime_type_iv: bufToBase64(mimetypeIvBytes),
          mime_type_auth_tag: bufToBase64(mimeTag),
          file_size: selectedFile.size,
          salt: bufToBase64(saltBytes),
          file_iv: bufToBase64(fileIvBytes),
          file_auth_tag: bufToBase64(fileAuthTagBytes),
          file_token: fileToken
        });

      if (dbError) {
        // Rollback storage upload on SQL failure
        await supabase.storage.from("encrypted_files").remove([storageFilename]);
        throw new Error(`Metadata registry insertion failed: ${dbError.message}`);
      }

      setLogs((prev) => [
        ...prev,
        createLog("[+] File fully packaged, encrypted, and saved on grid."),
        createLog("[!] CRYPTOGRAPHIC LEDGER UPDATED NOMINAL.")
      ]);

      // Construct decrypt URL & QR
      const decryptUrl = `${window.location.origin}/files/decrypt?token=${fileToken}`;
      const qrDataUrl = await QRCode.toDataURL(decryptUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: "#00FF00",
          light: "#000000"
        }
      });

      setShareFile({
        token: fileToken,
        url: decryptUrl,
        qrDataUrl
      });

      setSelectedFile(null);
      setPassphrase("");
      fetchFileList(user.id);

    } catch (err: any) {
      setUploadError("Something went wrong while encrypting or transferring your file. Please try again.");
      setLogs((prev) => [...prev, createLog(`[-] FILE PROCESSING ABORTED: ${err.message}`)]);
    } finally {
      setUploadLoading(false);
    }
  };

  // Unlock directory filenames list
  const handleUnlockDirectory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassphrase || files.length === 0) return;

    setLogs((prev) => [...prev, createLog("[*] Handshaking and decrypting directories...")]);
    const textDecoder = new TextDecoder();
    
    const decryptedList = await Promise.all(
      files.map(async (file) => {
        try {
          const saltBytes = base64ToBuf(file.salt);
          const key = await deriveKeyFromPassword(unlockPassphrase, saltBytes);

          // Decrypt filename
          const filenameBytes = base64ToBuf(file.file_name_encrypted);
          const filenameTag = base64ToBuf(file.file_name_auth_tag);
          const filenameIv = base64ToBuf(file.file_name_iv);

          const combinedFilename = new Uint8Array(filenameBytes.length + filenameTag.length);
          combinedFilename.set(filenameBytes);
          combinedFilename.set(filenameTag, filenameBytes.length);

          const decryptedFilenameBuf = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: filenameIv as BufferSource },
            key,
            combinedFilename as BufferSource
          );
          const decryptedName = textDecoder.decode(decryptedFilenameBuf);

          // Decrypt MIME
          const mimeBytes = base64ToBuf(file.mime_type_encrypted);
          const mimeTag = base64ToBuf(file.mime_type_auth_tag);
          const mimeIv = base64ToBuf(file.mime_type_iv);

          const combinedMime = new Uint8Array(mimeBytes.length + mimeTag.length);
          combinedMime.set(mimeBytes);
          combinedMime.set(mimeTag, mimeBytes.length);

          const decryptedMimeBuf = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: mimeIv as BufferSource },
            key,
            combinedMime as BufferSource
          );
          const decryptedMime = textDecoder.decode(decryptedMimeBuf);

          return {
            ...file,
            decryptedName,
            decryptedMime,
            decryptionError: false
          };
        } catch (_) {
          return {
            ...file,
            decryptedName: `[ LOCKED COORDINATE PAYLOAD ]`,
            decryptionError: true
          };
        }
      })
    );

    setFiles(decryptedList);
    setIsUnlocked(true);
    setLogs((prev) => [...prev, createLog("[+] Decryption pass complete. Directory names loaded.")]);
  };

  // Delete file mapping and storage object
  const handleDeleteFile = async (fileRecord: FileRecord) => {
    if (!confirm("Are you sure you want to permanently shred this encrypted file record from the database and storage grids?")) return;

    setLogs((prev) => [...prev, createLog(`[*] Deleting storage object: ${fileRecord.storage_path}...`)]);
    try {
      // 1. Remove from Storage
      const { error: storageError } = await supabase.storage
        .from("encrypted_files")
        .remove([fileRecord.storage_path]);

      if (storageError) {
        throw new Error(`Storage shredding failed: ${storageError.message}`);
      }

      // 2. Remove from DB mapping
      const { error: dbError } = await supabase
        .from("files")
        .delete()
        .eq("id", fileRecord.id);

      if (dbError) {
        throw new Error(`Database shredding failed: ${dbError.message}`);
      }

      setLogs((prev) => [...prev, createLog("[+] File and database coordinates shredded successfully.")]);
      if (user) {
        fetchFileList(user.id);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, createLog(`[-] Shredding sequence aborted: ${err.message}`)]);
    }
  };

  const handleCopyLink = () => {
    if (shareFile) {
      navigator.clipboard.writeText(shareFile.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setLogs((prev) => [...prev, createLog("[+] Decryption URL copied to clipboard.")]);
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
          <span>SECURED STORAGE GRIDS</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 z-20">
        
        {/* Left panel: Upload Form & directory list (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-green-900 rounded bg-zinc-950/90 p-6 md:p-8 shadow-[0_0_20px_rgba(0,255,0,0.02)]">
            
            <div className="flex items-center gap-3 mb-6">
              <div className="relative">
                <FileUp className="w-8 h-8 text-green-400 animate-pulse" />
                <div className="absolute -inset-1 bg-green-500/20 rounded-full blur animate-ping" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-wider">ENCRYPT & UPLOAD FILES</h2>
                <p className="text-xs text-green-700">AES-GCM-256 LOCAL BINARY TRANSLATION</p>
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
                <h3 className="text-white font-bold">Secure File Vault Locked</h3>
                <p className="text-xs text-red-400 max-w-md mx-auto leading-relaxed">
                  You must be logged in to upload and store files securely. Please log in first.
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
            ) : (
              /* Encrypted File upload Form */
              <form onSubmit={handleUpload} className="space-y-6">
                
                {/* File picker */}
                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold block uppercase">
                    CHOOSE FILE (MAX 25MB)
                  </label>
                  <input
                    type="file"
                    required
                    onChange={handleFileChange}
                    className="w-full text-xs text-green-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-bold file:bg-green-950/50 file:text-green-400 file:border-green-900 file:border file:cursor-pointer hover:file:bg-green-900 hover:file:text-black transition-all cursor-pointer font-mono p-3 border border-green-950 bg-black/60 rounded"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-green-700 font-bold block uppercase">
                    DECRYPT PASSCODE (ENCRYPTS METADATA & BLOB)
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 w-4 h-4 text-green-700" />
                    <input
                      type="password"
                      required
                      placeholder="Enter file packaging passphrase..."
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-green-950 bg-black/60 focus:border-green-500 text-sm text-green-400 placeholder:text-green-900 outline-none rounded transition-all duration-300 font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-green-800 leading-tight">
                    * Required. derived password is held locally. Supabase never receives the key.
                  </p>
                </div>

                {uploadError && (
                  <div className="text-xs border border-red-950 bg-red-950/20 text-red-400 p-3 rounded leading-relaxed">
                    [!] UPLOAD FAULT: {uploadError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={uploadLoading || !selectedFile}
                  className="w-full py-3 border border-green-500 bg-green-500/10 hover:bg-green-500 hover:text-black font-bold text-xs uppercase tracking-widest transition-all duration-300 rounded shadow-[0_0_15px_rgba(34,197,94,0.05)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {uploadLoading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      PACKAGING BLOB & TRANSMITTING...
                    </>
                  ) : (
                    "ENCRYPT & TRANSMIT FILE"
                  )}
                </button>
              </form>
            )}

          </div>

          {/* Files Directory display list */}
          {user && (
            <div className="border border-green-900 rounded bg-zinc-950/90 p-6 md:p-8 shadow-[0_0_20px_rgba(0,255,0,0.02)]">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">YOUR SECURED VAULT</h3>
                  <p className="text-xs text-green-700">Client-side ledger of your encrypted grid uploads</p>
                </div>
                
                {files.length > 0 && (
                  <form onSubmit={handleUnlockDirectory} className="flex gap-2 w-full md:w-auto">
                    <input
                      type="password"
                      required
                      placeholder="Password to view files"
                      value={unlockPassphrase}
                      onChange={(e) => setUnlockPassphrase(e.target.value)}
                      className="px-3 py-1.5 border border-green-950 bg-black/60 focus:border-green-500 text-xs text-green-400 placeholder:text-green-900 outline-none rounded font-mono w-full md:w-36"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 border border-green-500 hover:bg-green-500 hover:text-black text-xs font-bold transition-all duration-300 rounded cursor-pointer flex items-center gap-1"
                    >
                      <Unlock className="w-3.5 h-3.5" /> UNLOCK
                    </button>
                  </form>
                )}
              </div>

              {listLoading && files.length === 0 ? (
                <div className="text-xs text-green-700 animate-pulse text-center py-8">
                  Loading file list...
                </div>
              ) : files.length > 0 ? (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div 
                      key={file.id} 
                      className="border border-green-950 bg-green-950/5 p-4 rounded flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:border-green-800 transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <File className="w-8 h-8 text-green-500 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white truncate max-w-[250px] md:max-w-[320px]">
                            {file.decryptedName || `[ ENCRYPTED BLOB: ${file.file_token.substring(0,8)}... ]`}
                          </h4>
                          <div className="flex gap-2 text-[10px] text-green-700 mt-1">
                            <span>SIZE: {(file.file_size / 1024).toFixed(1)} KB</span>
                            <span>|</span>
                            <span>MIME: {file.decryptedMime || "locked/octet"}</span>
                            <span>|</span>
                            <span>{new Date(file.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 w-full md:w-auto">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/files/decrypt?token=${file.file_token}`;
                            QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: "#00FF00", light: "#000000" }})
                              .then((qrUrl) => {
                                setShareFile({
                                  token: file.file_token,
                                  url,
                                  qrDataUrl: qrUrl
                                });
                              });
                          }}
                          className="px-2.5 py-1.5 border border-green-900 text-green-700 hover:border-green-500 hover:text-green-400 text-[10px] font-bold rounded transition-all cursor-pointer"
                        >
                          SHARE QR
                        </button>
                        <button
                          onClick={() => handleDeleteFile(file)}
                          className="p-1.5 border border-red-950 bg-red-950/10 text-red-500 hover:bg-red-500 hover:text-black rounded transition-all cursor-pointer"
                          title="Shred this file permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-green-700 italic border border-dashed border-green-950/50 p-6 rounded text-center">
                  No encrypted file records found on the ledger. Upload a file above.
                </div>
              )}

            </div>
          )}
        </div>

        {/* Right Panel: Shared Modal details OR Telemetry Console (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6 min-h-[300px]">
          
          {/* Share QR Display Panel */}
          {shareFile && (
            <div className="border border-green-500 bg-zinc-950/90 p-6 rounded shadow-[0_0_20px_rgba(0,255,0,0.06)] space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-green-950 pb-2">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase">
                  <QrCode className="w-4 h-4 text-green-400 animate-pulse" /> SHARE ACTIVE QR FILE
                </h3>
                <button 
                  onClick={() => setShareFile(null)}
                  className="text-xs text-green-700 hover:text-red-400"
                >
                  [ CLOSE ]
                </button>
              </div>

              <div className="flex flex-col items-center gap-4 py-2">
                <div className="relative p-2 border-2 border-green-500 bg-black rounded">
                  <img src={shareFile.qrDataUrl} alt="File Decrypt QR" className="w-44 h-44" />
                </div>

                <div className="w-full space-y-2">
                  <div className="space-y-1">
                    <span className="text-[9px] text-green-700 font-bold block uppercase">DOWNLOAD DECRYPT URL</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareFile.url}
                        className="w-full px-2.5 py-1.5 border border-green-950 bg-black/60 text-[10px] text-green-400 rounded outline-none font-mono"
                      />
                      <button
                        onClick={handleCopyLink}
                        className="px-3 py-1.5 border border-green-500 hover:bg-green-500 hover:text-black text-xs font-bold transition-all rounded cursor-pointer"
                      >
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] text-green-700 font-bold block uppercase">SECURE FILE COORDINATES</span>
                    <input
                      type="text"
                      readOnly
                      value={shareFile.token}
                      className="w-full px-2.5 py-1.5 border border-green-950 bg-black/60 text-[9px] text-green-500 rounded outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Telemetry Console */}
          <FilesConsole logs={logs} />
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
