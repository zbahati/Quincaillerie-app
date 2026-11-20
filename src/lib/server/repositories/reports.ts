import "server-only";

import type { Pool } from "pg";

export interface DailyReportRecord {
  businessName: string;
  branchName: string;
  fromDate: string;
  toDate: string;
  saleCount: number;
  salesTotal: number;
  collectedAtSale: number;
  creditSales: number;
  customerRepayments: number;
  expensesTotal: number;
  expensesByCategory: Array<{ category: string; amount: number }>;
  purchasesReceived: number;
  supplierPayments: number;
  openingPhysicalCash: number;
  cashInflow: number;
  cashOutflow: number;
  calculatedPhysicalCash: number;
  openingCustomerOutstanding: number;
  closingCustomerOutstanding: number;
  grossProfit: number;
  stockAdjustmentCount: number;
}

export interface IncomeStatementRecord {
  businessName: string;
  branchName: string;
  fromDate: string;
  toDate: string;
  saleCount: number;
  salesTotal: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expensesTotal: number;
  operatingResult: number;
  expensesByCategory: Array<{ category: string; amount: number }>;
}

export interface BalanceSheetRecord {
  businessName: string;
  branchName: string;
  reportDate: string;
  cashAccounts: Array<{ accountType: string; name: string; balance: number }>;
  cashAndBank: number;
  inventory: number;
  accountsReceivable: number;
  totalAssets: number;
  accountsPayable: number;
  totalLiabilities: number;
  retainedEarnings: number;
  ownerEquity: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanceDifference: number;
  isArithmeticallyBalanced: boolean;
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

function safeNonNegativeInteger(value: string, field: string): number {
  const parsed = safeInteger(value, field);
  if (parsed < 0) throw new Error(`The stored ${field} is negative.`);
  return parsed;
}

function checkedAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The calculated ${field} exceeds the browser's safe integer range.`);
  }
  return result;
}

function checkedSubtract(left: number, right: number, field: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The calculated ${field} exceeds the browser's safe integer range.`);
  }
  return result;
}

function roundToWholeRwf(amountInHundredths: number, field: string): number {
  const amount = BigInt(amountInHundredths);
  const roundedRwf = amount >= 0n ? (amount + 50n) / 100n : (amount - 50n) / 100n;
  return safeInteger((roundedRwf * 100n).toString(), field);
}

export async function calculateDailyReport(
  pool: Pool,
  businessId: string,
  branchId: string,
  fromDate: string,
  toDate: string,
): Promise<DailyReportRecord> {
  const business = await pool.query<{ businessName: string }>(
    `SELECT name AS "businessName" FROM businesses WHERE id = $1 AND is_active = TRUE`,
    [businessId],
  );
  if (business.rowCount !== 1) throw new Error("The business is unavailable.");
  const branch = await pool.query<{ branchName: string }>(
    `SELECT name AS "branchName" FROM branches
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE`,
    [businessId, branchId],
  );
  if (branch.rowCount !== 1) throw new Error("The branch is unavailable.");

  const sales = await pool.query<{
    saleCount: string;
    salesTotal: string;
    collected: string;
    credit: string;
  }>(
    `SELECT
       COUNT(*)::text AS "saleCount",
       COALESCE(SUM(s.total), 0)::text AS "salesTotal",
       COALESCE(SUM((
         SELECT COALESCE(SUM(sp.amount), 0)
         FROM sale_payments sp
         WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
       )), 0)::text AS collected,
       COALESCE(SUM(s.total - COALESCE((
         SELECT SUM(sp.amount)
         FROM sale_payments sp
         WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
       ), 0)), 0)::text AS credit
     FROM sales s
     WHERE s.business_id = $1 AND s.branch_id = $2
       AND s.status = 'completed'
       AND s.created_at::date >= $3::date
       AND s.created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );
  const saleRow = sales.rows[0];

  const repayments = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(dp.amount), 0)::text AS amount
     FROM customer_debt_payments dp
     JOIN customer_debts cd ON cd.id = dp.debt_id AND cd.business_id = dp.business_id
     JOIN sales s ON s.id = cd.sale_id AND s.business_id = cd.business_id
     WHERE dp.business_id = $1 AND s.branch_id = $2
       AND dp.created_at::date >= $3::date
       AND dp.created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );

  const expenses = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE business_id = $1 AND branch_id = $2
       AND expense_date >= $3::date
       AND expense_date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );
  const expenseCategories = await pool.query<{ category: string; amount: string }>(
    `SELECT category, SUM(amount)::text AS amount
     FROM expenses
     WHERE business_id = $1 AND branch_id = $2
       AND expense_date >= $3::date
       AND expense_date <= $4::date
     GROUP BY category
     ORDER BY category`,
    [businessId, branchId, fromDate, toDate],
  );

  const receipt = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(pri.total_cost), 0)::text AS amount
     FROM purchase_receipts pr
     JOIN purchase_receipt_items pri ON pri.business_id = pr.business_id AND pri.receipt_id = pr.id
     WHERE pr.business_id = $1 AND pr.branch_id = $2
       AND pr.created_at::date >= $3::date
       AND pr.created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );

  const stock = await pool.query<{
    opening: string;
    closing: string;
    adjustments: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN sm.created_at::date < $3::date THEN sm.quantity_delta ELSE 0 END), 0)::text AS opening,
       COALESCE(SUM(sm.quantity_delta), 0)::text AS closing,
       COALESCE(COUNT(*) FILTER (WHERE sm.movement_type = 'stock_correction'), 0)::text AS adjustments
     FROM stock_movements sm
     WHERE sm.business_id = $1 AND sm.branch_id = $2
       AND sm.created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );

  const customerOpening = 0;
  const customerClosing = safeInteger(saleRow?.credit ?? "0", "credit sales");

  const collected = safeInteger(saleRow?.collected ?? "0", "collected sales");
  const repaymentsAmount = safeInteger(repayments.rows[0]?.amount ?? "0", "customer repayments");
  const expensesAmount = safeInteger(expenses.rows[0]?.total ?? "0", "expenses");
  const openingCashRow = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(o.opening_amount), 0)::text AS amount
     FROM cash_account_openings o
     JOIN cash_accounts ca ON ca.id = o.account_id AND ca.business_id = o.business_id
     WHERE o.business_id = $1 AND ca.branch_id = $2
       AND ca.account_type = 'cash_drawer'`,
    [businessId, branchId],
  );
  const openingCash = safeInteger(openingCashRow.rows[0]?.amount ?? "0", "opening cash");
  const cashMovements = await pool.query<{ direction: string; amount: string }>(
    `SELECT direction, SUM(amount)::text AS amount
     FROM cash_movements cm
     JOIN cash_accounts ca ON ca.id = cm.account_id AND ca.business_id = cm.business_id
     WHERE cm.business_id = $1
       AND ca.branch_id = $2
       AND ca.account_type = 'cash_drawer'
       AND cm.recorded_at::date >= $3::date
       AND cm.recorded_at::date <= $4::date
     GROUP BY direction`,
    [businessId, branchId, fromDate, toDate],
  );
  let periodCashIn = 0;
  let periodCashOut = 0;
  for (const row of cashMovements.rows) {
    const amount = safeInteger(row.amount, "cash movement");
    if (row.direction === "in") periodCashIn += amount;
    else periodCashOut += amount;
  }

  return {
    businessName: business.rows[0].businessName,
    branchName: branch.rows[0].branchName,
    fromDate,
    toDate,
    saleCount: safeInteger(saleRow?.saleCount ?? "0", "sale count"),
    salesTotal: safeInteger(saleRow?.salesTotal ?? "0", "sales total"),
    collectedAtSale: collected,
    creditSales: safeInteger(saleRow?.credit ?? "0", "credit sales"),
    customerRepayments: repaymentsAmount,
    expensesTotal: expensesAmount,
    expensesByCategory: expenseCategories.rows.map((row) => ({
      category: row.category,
      amount: safeInteger(row.amount, "expense category"),
    })),
    purchasesReceived: safeInteger(receipt.rows[0]?.amount ?? "0", "purchase receipts"),
    supplierPayments: 0,
    openingPhysicalCash: openingCash,
    cashInflow: periodCashIn,
    cashOutflow: periodCashOut,
    calculatedPhysicalCash: openingCash + periodCashIn - periodCashOut,
    openingCustomerOutstanding: customerOpening,
    closingCustomerOutstanding: customerClosing,
    grossProfit: safeInteger(saleRow?.salesTotal ?? "0", "gross sales") - 0,
    stockAdjustmentCount: safeInteger(stock.rows[0]?.adjustments ?? "0", "stock adjustments"),
  };
}

export async function calculateIncomeStatement(
  pool: Pool,
  businessId: string,
  branchId: string,
  fromDate: string,
  toDate: string,
): Promise<IncomeStatementRecord> {
  const business = await pool.query<{ name: string }>(
    `SELECT name FROM businesses WHERE id = $1 AND is_active = TRUE`,
    [businessId],
  );
  if (business.rowCount !== 1) throw new Error("The business is unavailable.");
  const branch = await pool.query<{ name: string }>(
    `SELECT name FROM branches
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE`,
    [businessId, branchId],
  );
  if (branch.rowCount !== 1) throw new Error("The branch is unavailable.");

  const sales = await pool.query<{ count: string; revenue: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(total), 0)::text AS revenue
     FROM sales
     WHERE business_id = $1 AND branch_id = $2
       AND status = 'completed'
       AND created_at::date >= $3::date
       AND created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );
  const cost = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(si.total_cost), 0)::text AS amount
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
     WHERE si.business_id = $1 AND s.branch_id = $2
       AND s.status = 'completed'
       AND s.created_at::date >= $3::date
       AND s.created_at::date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );
  const expenses = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS amount
     FROM expenses
     WHERE business_id = $1 AND branch_id = $2
       AND expense_date >= $3::date
       AND expense_date <= $4::date`,
    [businessId, branchId, fromDate, toDate],
  );
  const categories = await pool.query<{ category: string; amount: string }>(
    `SELECT category, SUM(amount)::text AS amount
     FROM expenses
     WHERE business_id = $1 AND branch_id = $2
       AND expense_date >= $3::date
       AND expense_date <= $4::date
     GROUP BY category
     ORDER BY category`,
    [businessId, branchId, fromDate, toDate],
  );

  const salesTotal = safeInteger(sales.rows[0]?.revenue ?? "0", "income sales revenue");
  const cogs = safeInteger(cost.rows[0]?.amount ?? "0", "income cost of goods sold");
  const expensesTotal = safeInteger(expenses.rows[0]?.amount ?? "0", "income expenses");
  return {
    businessName: business.rows[0].name,
    branchName: branch.rows[0].name,
    fromDate,
    toDate,
    saleCount: safeInteger(sales.rows[0]?.count ?? "0", "income sale count"),
    salesTotal,
    costOfGoodsSold: cogs,
    grossProfit: salesTotal - cogs,
    expensesTotal,
    operatingResult: salesTotal - cogs - expensesTotal,
    expensesByCategory: categories.rows.map((row) => ({
      category: row.category,
      amount: safeInteger(row.amount, "income expense category"),
    })),
  };
}

export async function calculateBalanceSheet(
  pool: Pool,
  businessId: string,
  branchId: string,
  reportDate: string,
): Promise<BalanceSheetRecord> {
  const business = await pool.query<{ name: string }>(
    `SELECT name FROM businesses WHERE id = $1 AND is_active = TRUE`,
    [businessId],
  );
  if (business.rowCount !== 1) throw new Error("The business is unavailable.");
  const branch = await pool.query<{ name: string }>(
    `SELECT name FROM branches
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE`,
    [businessId, branchId],
  );
  if (branch.rowCount !== 1) throw new Error("The branch is unavailable.");

  const accountRows = await pool.query<{
    id: string;
    accountType: string;
    name: string;
    balance: string;
  }>(
    `SELECT ca.id,
            ca.account_type AS "accountType", ca.name,
            COALESCE(o.opening_amount, 0)::text AS balance
     FROM cash_accounts ca
     LEFT JOIN cash_account_openings o
       ON o.business_id = ca.business_id AND o.account_id = ca.id
     WHERE ca.business_id = $1
       AND ca.branch_id = $2
     ORDER BY ca.account_type, lower(ca.name), ca.id`,
    [businessId, branchId],
  );
  const accounts: Array<{ accountType: string; name: string; balance: number }> = [];
  let cashAndBank = 0;
  for (const row of accountRows.rows) {
    const opening = safeNonNegativeInteger(row.balance, "cash account opening");
    const movements = await pool.query<{ amount: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)::text AS amount
       FROM cash_movements
       WHERE business_id = $1
         AND account_id = $2
         AND recorded_at::date <= $3::date`,
      [businessId, row.id, reportDate],
    );
    const movementTotal = safeInteger(movements.rows[0]?.amount ?? "0", "cash movement balance");
    const balance = roundToWholeRwf(
      checkedAdd(opening, movementTotal, "cash account balance"),
      "cash account balance",
    );
    if (balance < 0) throw new Error("A cash account balance is negative for the selected date.");
    accounts.push({ accountType: row.accountType, name: row.name, balance });
    cashAndBank = checkedAdd(cashAndBank, balance, "cash and bank total");
  }

  const inventory = await pool.query<{ amount: string; minimumQuantity: string | null }>(
    `SELECT COALESCE((ROUND(SUM(
              (ib.quantity_on_hand - COALESCE((
                SELECT SUM(sm.quantity_delta)
                FROM stock_movements sm
                WHERE sm.business_id = ib.business_id
                  AND sm.branch_id = ib.branch_id
                  AND sm.product_id = ib.product_id
                  AND sm.created_at::date > $3::date
              ), 0))::numeric * ib.average_unit_cost::numeric / 100000
            )) * 100)::bigint::text, '0') AS amount,
            MIN(ib.quantity_on_hand - COALESCE((
              SELECT SUM(sm.quantity_delta)
              FROM stock_movements sm
              WHERE sm.business_id = ib.business_id
                AND sm.branch_id = ib.branch_id
                AND sm.product_id = ib.product_id
                AND sm.created_at::date > $3::date
            ), 0))::text AS "minimumQuantity"
     FROM inventory_balances ib
     WHERE ib.business_id = $1 AND ib.branch_id = $2`,
    [businessId, branchId, reportDate],
  );
  const historicalQuantity = inventory.rows[0]?.minimumQuantity;
  if (historicalQuantity !== null && historicalQuantity !== undefined &&
      safeInteger(historicalQuantity, "historical inventory quantity") < 0) {
    throw new Error("Historical inventory quantity is negative for the selected date.");
  }
  const inventoryValue = safeNonNegativeInteger(inventory.rows[0]?.amount ?? "0", "balance sheet inventory");

  const receivable = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(GREATEST(
       LEAST(d.original_amount, GREATEST(
         s.total - COALESCE((
           SELECT SUM(sp.amount) FROM sale_payments sp
           WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
             AND sp.created_at::date <= $3::date
         ), 0)
       , 0))
       - COALESCE((
         SELECT SUM(dp.amount)
         FROM customer_debt_payments dp
         WHERE dp.business_id = d.business_id AND dp.debt_id = d.id
           AND dp.created_at::date <= $3::date
       ), 0),
       0)), 0)::text AS amount
     FROM customer_debts d
     JOIN sales s ON s.business_id = d.business_id AND s.id = d.sale_id
     WHERE d.business_id = $1 AND s.branch_id = $2
       AND s.status = 'completed'
       AND s.created_at::date <= $3::date
       AND d.created_at::date <= $3::date`,
    [businessId, branchId, reportDate],
  );
  const accountsReceivable = roundToWholeRwf(
    safeNonNegativeInteger(receivable.rows[0]?.amount ?? "0", "accounts receivable"),
    "accounts receivable",
  );

  const payable = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(
       p.subtotal - COALESCE((
         SELECT SUM(cm.amount)
         FROM cash_movements cm
         JOIN purchase_payments pp
           ON pp.business_id = cm.business_id AND pp.id = cm.source_id
         WHERE cm.business_id = p.business_id
           AND pp.purchase_id = p.id
           AND cm.source_type = 'purchase_payment'
           AND cm.movement_type = 'supplier_payment'
           AND cm.direction = 'out'
           AND cm.recorded_at::date <= $3::date
       ), 0)
     ), 0)::text AS amount
     FROM purchases p
     WHERE p.business_id = $1 AND p.branch_id = $2
       AND p.created_at::date <= $3::date`,
    [businessId, branchId, reportDate],
  );
  const accountsPayable = roundToWholeRwf(
    safeNonNegativeInteger(payable.rows[0]?.amount ?? "0", "accounts payable"),
    "accounts payable",
  );

  const totalAssets = checkedAdd(
    checkedAdd(cashAndBank, inventoryValue, "total assets"),
    accountsReceivable,
    "total assets",
  );
  const totalLiabilities = accountsPayable;
  const retained = await pool.query<{ revenue: string; cost: string; expenses: string }>(
    `SELECT
       COALESCE((
         SELECT SUM(s.total) FROM sales s
         WHERE s.business_id = $1 AND s.branch_id = $2 AND s.status = 'completed'
           AND s.created_at::date <= $3::date
       ), 0)::text AS revenue,
       COALESCE((
         SELECT SUM(si.total_cost)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
         WHERE s.business_id = $1 AND s.branch_id = $2 AND s.status = 'completed'
           AND s.created_at::date <= $3::date
       ), 0)::text AS cost,
       COALESCE((
         SELECT SUM(e.amount) FROM expenses e
         WHERE e.business_id = $1 AND e.branch_id = $2
           AND e.expense_date <= $3::date
       ), 0)::text AS expenses`,
    [businessId, branchId, reportDate],
  );
  const retainedEarningsInHundredths = checkedSubtract(
    checkedSubtract(
      safeInteger(retained.rows[0]?.revenue ?? "0", "retained earnings revenue"),
      safeInteger(retained.rows[0]?.cost ?? "0", "retained earnings cost of goods sold"),
      "retained earnings",
    ),
    safeInteger(retained.rows[0]?.expenses ?? "0", "retained earnings expenses"),
    "retained earnings",
  );
  const retainedEarnings = roundToWholeRwf(
    retainedEarningsInHundredths,
    "retained earnings",
  );
  const ownerEquity = checkedSubtract(
    checkedSubtract(totalAssets, totalLiabilities, "owner equity"),
    retainedEarnings,
    "owner equity",
  );
  const totalEquity = checkedAdd(retainedEarnings, ownerEquity, "total equity");
  const totalLiabilitiesAndEquity = checkedAdd(totalLiabilities, totalEquity, "liabilities and equity");
  const balanceDifference = checkedSubtract(totalAssets, totalLiabilitiesAndEquity, "balance difference");

  return {
    businessName: business.rows[0].name,
    branchName: branch.rows[0].name,
    reportDate,
    cashAccounts: accounts,
    cashAndBank,
    inventory: inventoryValue,
    accountsReceivable,
    totalAssets,
    accountsPayable,
    totalLiabilities,
    retainedEarnings,
    ownerEquity,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanceDifference,
    isArithmeticallyBalanced: balanceDifference === 0,
  };
}
