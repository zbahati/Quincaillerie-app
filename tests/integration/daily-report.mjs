import assert from "node:assert/strict";
import test from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required.");
process.env.DATABASE_URL = testDatabaseUrl;

test("daily report calculates branch sales, expenses, cash movements and customer debt", async () => {
  const [
    { getDatabasePool },
    { withTransaction },
    { createBusiness },
    { createBranch },
    { createAdminUser },
  ] = await Promise.all([
    import("../../src/lib/server/db/pool.ts"),
    import("../../src/lib/server/db/transaction.ts"),
    import("../../src/lib/server/repositories/businesses.ts"),
    import("../../src/lib/server/repositories/branches.ts"),
    import("../../src/lib/server/repositories/users.ts"),
  ]);
  const { calculateDailyReport } = await import("../../src/lib/server/repositories/reports.ts");
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const date = new Date().toISOString().slice(0, 10);
  let businessId;
  let branchId;
  let accountId;
  let bankAccountId;

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `Report ${unique}` });
      businessId = business.id;
      const admin = await createAdminUser(client, {
        businessId,
        username: `report.admin.${unique.slice(-8)}`,
        fullName: "Report Admin",
        email: `report-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, businessId, { name: "Report Main" }, true);
      branchId = branch.id;
      const account = await client.query(
        `INSERT INTO cash_accounts
           (business_id, branch_id, account_type, name, responsible_user_id)
         VALUES ($1, $2, 'cash_drawer', 'Main drawer', $3)
         RETURNING id`,
        [businessId, branchId, admin.id],
      );
      accountId = account.rows[0].id;
      const bankAccount = await client.query(
        `INSERT INTO cash_accounts
           (business_id, branch_id, account_type, name, responsible_user_id)
         VALUES ($1, $2, 'bank', 'Main bank', $3)
         RETURNING id`,
        [businessId, branchId, admin.id],
      );
      bankAccountId = bankAccount.rows[0].id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 100000, $3, $3)`,
        [businessId, accountId, admin.id],
      );
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 500000, $3, $3)`,
        [businessId, bankAccountId, admin.id],
      );
      await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, total)
         VALUES ($1, $2, $3, 24000, 24000)`,
        [businessId, branchId, `SALE-REPORT-${unique}`],
      );
      await client.query(
        `INSERT INTO expenses
           (business_id, branch_id, category, amount, expense_date, payment_method,
            cash_account_id, description, responsible_name)
         VALUES ($1, $2, 'rent', 25000, $3, 'cash', $4, 'Monthly rent', 'Report Admin')`,
        [businessId, branchId, date, accountId],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type,
            source_id, responsible_user_id, description)
         VALUES ($1, $2, 'expense_payment', 'out', 25000, 'expense_payment',
                 gen_random_uuid(), $3, 'Monthly rent')`,
        [businessId, accountId, admin.id],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type, description)
         VALUES
           ($1, $2, 'other_receipt', 'in', 12000, 'other', 'Cash drawer receipt'),
           ($1, $3, 'other_receipt', 'in', 40000, 'other', 'Bank receipt'),
           ($1, $3, 'other_payment', 'out', 10000, 'other', 'Bank payment')`,
        [businessId, accountId, bankAccountId],
      );
    });

    const report = await calculateDailyReport(pool, businessId, branchId, date, date);
    assert.equal(report.branchName, "Report Main");
    assert.equal(report.expensesTotal, 25000);
    assert.equal(report.salesTotal, 24000);
    assert.equal(report.openingPhysicalCash, 100000);
    assert.equal(report.cashInflow, 12000);
    assert.equal(report.cashOutflow, 25000);
    assert.equal(report.calculatedPhysicalCash, 87000);
  } finally {
    if (businessId) {
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM expenses WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sales WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
