import { 
  encryptText, 
  decryptText, 
  generateAsymmetricKeyPair, 
  exportPublicKey, 
  importPublicKey, 
  exportPrivateKey, 
  importPrivateKey,
  encryptAsymmetric,
  decryptAsymmetric
} from "./crypto";

async function runTests() {
  console.log("====================================================");
  console.log("STARTING WEB CRYPTO ALGORITHM TEST SUITE");
  console.log("====================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`[ OK ] ${message}`);
      passed++;
    } else {
      console.log(`[FAIL] ${message}`);
      failed++;
    }
  }

  // Test 1: Symmetric Round-trip
  try {
    const password = "cyber_secure_password_99";
    const plaintext = "This is a highly secure classification code.";
    
    console.log("\n--- TEST 1: Symmetric AES-GCM-256 ---");
    const encrypted = await encryptText(plaintext, password);
    assert(encrypted.cipherText !== plaintext, "Ciphertext is randomized & encrypted");
    
    const decrypted = await decryptText(
      encrypted.cipherText, 
      encrypted.salt, 
      encrypted.iv, 
      encrypted.authTag, 
      password
    );
    assert(decrypted === plaintext, "Decrypted text matches plaintext");
  } catch (err: any) {
    console.error("[FAIL] Test 1 encountered error:", err);
    failed++;
  }

  // Test 2: Symmetric Failure / Tampering Checks
  try {
    const password = "cyber_secure_password_99";
    const plaintext = "This is a highly secure classification code.";
    console.log("\n--- TEST 2: Tampering and Incorrect Password ---");
    
    const encrypted = await encryptText(plaintext, password);
    
    // Attempt 2.1: Incorrect password
    let failedPasswordThrew = false;
    try {
      await decryptText(
        encrypted.cipherText, 
        encrypted.salt, 
        encrypted.iv, 
        encrypted.authTag, 
        "wrong_password"
      );
    } catch {
      failedPasswordThrew = true;
    }
    assert(failedPasswordThrew, "Decryption throws error for incorrect password");

    // Attempt 2.2: Tampered ciphertext
    let tamperedThrew = false;
    try {
      const tamperedCipher = encrypted.cipherText.substring(0, 5) + "X" + encrypted.cipherText.substring(6);
      await decryptText(
        tamperedCipher, 
        encrypted.salt, 
        encrypted.iv, 
        encrypted.authTag, 
        password
      );
    } catch {
      tamperedThrew = true;
    }
    assert(tamperedThrew, "Decryption throws error when ciphertext is tampered");
  } catch (err: any) {
    console.error("[FAIL] Test 2 encountered error:", err);
    failed++;
  }

  // Test 3: Asymmetric Key Pair Export / Import
  try {
    console.log("\n--- TEST 3: RSA-OAEP-2048 Key Lifecycle ---");
    const password = "key_export_pass_77";
    const pair = await generateAsymmetricKeyPair();
    
    const exportedPub = await exportPublicKey(pair.publicKey);
    const importedPub = await importPublicKey(exportedPub);
    assert(importedPub.type === "public", "Successfully exported & imported public key");

    const exportedPriv = await exportPrivateKey(pair.privateKey, password);
    const importedPriv = await importPrivateKey(
      exportedPriv.encryptedPrivateKey,
      exportedPriv.salt,
      exportedPriv.iv,
      exportedPriv.authTag,
      password
    );
    assert(importedPriv.type === "private", "Successfully exported, encrypted, & imported private key");
  } catch (err: any) {
    console.error("[FAIL] Test 3 encountered error:", err);
    failed++;
  }

  // Test 4: Hybrid Asymmetric E2E Chat Message Envelope
  try {
    console.log("\n--- TEST 4: Hybrid Envelope E2E Round-trip ---");
    const pair = await generateAsymmetricKeyPair();
    const chatMessage = "Meeting at sectors 9 at midnight.";

    const encryptedEnvelope = await encryptAsymmetric(pair.publicKey, chatMessage);
    assert(encryptedEnvelope.cipherText !== chatMessage, "Asymmetric payload is encrypted");
    assert(encryptedEnvelope.encryptedKey.length > 0, "Symmetric key is envelope encrypted");

    const decryptedEnvelope = await decryptAsymmetric(
      pair.privateKey,
      encryptedEnvelope.cipherText,
      encryptedEnvelope.encryptedKey,
      encryptedEnvelope.iv,
      encryptedEnvelope.authTag
    );
    assert(decryptedEnvelope === chatMessage, "Asymmetric decrypted text matches plaintext");
  } catch (err: any) {
    console.error("[FAIL] Test 4 encountered error:", err);
    failed++;
  }

  console.log("\n====================================================");
  console.log(`TEST RUN COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log("====================================================");
  
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
