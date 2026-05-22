import pool from "./pool.js"; 

export async function clearDatabase() {
  const client = await pool.connect();
  try {
    console.log("Initiating database purge...");
    await client.query("BEGIN");
    
    // Ordered to respect foreign key references
    await client.query("DELETE FROM card_choices");
    await client.query("DELETE FROM cards");
    await client.query("DELETE FROM decks");
    await client.query("DELETE FROM users");
    await client.query("DELETE FROM session");
    await client.query("DELETE FROM share_tokens");

    await client.query("COMMIT");
    console.log("Database tables cleared successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Purge failed, transaction rolled back:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Execute directly if run via CLI
if (process.argv[1] === import.meta.filename) {
  clearDatabase()
    .then(() => pool.end())
    .catch(() => process.exit(1));
}
