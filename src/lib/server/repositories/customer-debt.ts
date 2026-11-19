import "server-only";

import type { Pool, PoolClient } from "pg";

import type { CustomerDebtPaymentInput } from "@/lib/server/schemas/customer-debt";

export type CustomerDebtExecutor = Pool | PoolClient;

export interface CustomerDebtRecord {
  id: string;
  customerId: string;
  customerName: string;
  saleId: string;
  transactionNumber: string;
  originalAmount: number;
  amountPaid: number;
  balanceDue: number;
  createdAt: Date;
}

export interface CustomerStatementEntryRecord {
  id: string;
  transactionNumber: string;
  entryType: "sale" | "sale_payment" | "repayment";
  paymentMethod: string | null;
  amount: number;
  balanceAfter: number;
  createdAt: Date;
}

export interface CustomerStatementRecord {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    customerType: "individual" | "business";
    creditLimit: number;
  };
  totalSales: number;
  totalPayments: number;
  outstandingBalance: number;
  entries: CustomerStatementEntryRecord[];
}

export class CustomerDebtRuleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "CustomerDebtRuleError";
  }
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

export async function listCustomerDebts(
  executor: CustomerDebtExecutor,
  businessId: string,
): Promise<CustomerDebtRecord[]> {
  const result = await executor.query<{
    id: string;
    customerId: string;
    customerName: string;
    saleId: string;
    transactionNumber: string;
    originalAmount: string;
    amountPaid: string;
    createdAt: Date;
  }>(
    `SELECT d.id, d.customer_id AS "customerId", c.name AS "customerName",
            d.sale_id AS "saleId", s.transaction_number AS "transactionNumber",
           LEAST(d.original_amount, GREATEST(
             s.total - COALESCE((
               SELECT SUM(sp.amount)
               FROM sale_payments sp
               WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
             ), 0)
           , 0))::text AS "originalAmount",
            COALESCE((
              SELECT SUM(dp.amount)
              FROM customer_debt_payments dp
              WHERE dp.business_id = d.business_id AND dp.debt_id = d.id
            ), 0)::text AS "amountPaid",
            d.created_at AS "createdAt"
     FROM customer_debts d
     JOIN customers c ON c.id = d.customer_id AND c.business_id = d.business_id
     JOIN sales s ON s.id = d.sale_id AND s.business_id = d.business_id
     WHERE d.business_id = $1
     ORDER BY d.created_at DESC, d.id`,
    [businessId],
  );
  return result.rows.map((row) => {
    const amountPaid = safeInteger(row.amountPaid, "customer repayment");
    const originalAmount = safeInteger(row.originalAmount, "customer debt");
    return {
      id: row.id,
      customerId: row.customerId,
      customerName: row.customerName,
      saleId: row.saleId,
      transactionNumber: row.transactionNumber,
      originalAmount,
      amountPaid,
      balanceDue: Math.max(originalAmount - amountPaid, 0),
      createdAt: row.createdAt,
    };
  });
}

export async function recordCustomerDebtPayment(
  client: PoolClient,
  businessId: string,
  debtId: string,
  input: CustomerDebtPaymentInput,
): Promise<{ paymentId: string; customerName: string; balanceDue: number }> {
  const debt = await client.query<{
    id: string;
    customerName: string;
    originalAmount: string;
  }>(
    `SELECT d.id, c.name AS "customerName",
            LEAST(d.original_amount, GREATEST(
              s.total - COALESCE((
                SELECT SUM(sp.amount)
                FROM sale_payments sp
                WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
              ), 0)
            , 0))::text AS "originalAmount"
     FROM customer_debts d
     JOIN customers c ON c.id = d.customer_id AND c.business_id = d.business_id
     JOIN sales s ON s.id = d.sale_id AND s.business_id = d.business_id
     WHERE d.business_id = $1 AND d.id = $2
     FOR UPDATE OF d`,
    [businessId, debtId],
  );
  if (debt.rowCount !== 1) {
    throw new CustomerDebtRuleError(404, "customer_debt_not_found", "The customer debt is unavailable.");
  }
  const paid = await client.query<{ amount: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS amount
     FROM customer_debt_payments
     WHERE business_id = $1 AND debt_id = $2`,
    [businessId, debtId],
  );
  const original = safeInteger(debt.rows[0].originalAmount, "customer debt");
  const paidAmount = safeInteger(paid.rows[0]?.amount ?? "0", "customer repayment");
  const balanceDue = Math.max(original - paidAmount, 0);
  if (input.amount > balanceDue) {
    throw new CustomerDebtRuleError(400, "repayment_exceeds_balance", "Repayment cannot exceed the outstanding balance.");
  }
  const payment = await client.query<{ id: string }>(
    `INSERT INTO customer_debt_payments
       (business_id, debt_id, payment_method, amount)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [businessId, debtId, input.paymentMethod, input.amount],
  );
  return {
    paymentId: payment.rows[0].id,
    customerName: debt.rows[0].customerName,
    balanceDue: balanceDue - input.amount,
  };
}

export async function getCustomerStatement(
  executor: CustomerDebtExecutor,
  businessId: string,
  customerId: string,
): Promise<CustomerStatementRecord | null> {
  const customer = await executor.query<{
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    customerType: "individual" | "business";
    creditLimit: string;
  }>(
    `SELECT id, name, phone, address, customer_type AS "customerType",
            credit_limit::text AS "creditLimit"
     FROM customers
     WHERE business_id = $1 AND id = $2`,
    [businessId, customerId],
  );
  if (customer.rowCount !== 1) return null;
  const row = customer.rows[0];

  const entries: CustomerStatementEntryRecord[] = [];
  let totalSales = 0;
  let totalPayments = 0;
  let balance = 0;

  const sales = await executor.query<{
    id: string;
    transactionNumber: string;
    amount: string;
    createdAt: Date;
  }>(
    `SELECT s.id, s.transaction_number AS "transactionNumber",
            s.total::text AS amount, s.created_at AS "createdAt"
     FROM sales s
     WHERE s.business_id = $1 AND s.customer_id = $2 AND s.status = 'completed'
     ORDER BY s.created_at, s.id`,
    [businessId, customerId],
  );
  for (const sale of sales.rows) {
    const amount = safeInteger(sale.amount, "sale total");
    totalSales += amount;
    balance += amount;
    entries.push({
      id: sale.id,
      transactionNumber: sale.transactionNumber,
      entryType: "sale",
      paymentMethod: null,
      amount,
      balanceAfter: balance,
      createdAt: sale.createdAt,
    });

    const salePayments = await executor.query<{
      id: string;
      paymentMethod: string;
      amount: string;
      createdAt: Date;
    }>(
      `SELECT id, payment_method AS "paymentMethod", amount::text AS amount,
              created_at AS "createdAt"
       FROM sale_payments
       WHERE business_id = $1 AND sale_id = $2
       ORDER BY created_at, id`,
      [businessId, sale.id],
    );
    for (const payment of salePayments.rows) {
      const amount = safeInteger(payment.amount, "sale payment");
      totalPayments += amount;
      balance -= amount;
      entries.push({
        id: payment.id,
        transactionNumber: sale.transactionNumber,
        entryType: "sale_payment",
        paymentMethod: payment.paymentMethod,
        amount,
        balanceAfter: balance,
        createdAt: payment.createdAt,
      });
    }

    const repayments = await executor.query<{
      id: string;
      paymentMethod: string;
      amount: string;
      createdAt: Date;
    }>(
      `SELECT dp.id, dp.payment_method AS "paymentMethod", dp.amount::text AS amount,
              dp.created_at AS "createdAt"
       FROM customer_debt_payments dp
       JOIN customer_debts cd ON cd.id = dp.debt_id AND cd.business_id = dp.business_id
       WHERE dp.business_id = $1 AND cd.sale_id = $2
       ORDER BY dp.created_at, dp.id`,
      [businessId, sale.id],
    );
    for (const payment of repayments.rows) {
      const amount = safeInteger(payment.amount, "debt repayment");
      totalPayments += amount;
      balance -= amount;
      entries.push({
        id: payment.id,
        transactionNumber: sale.transactionNumber,
        entryType: "repayment",
        paymentMethod: payment.paymentMethod,
        amount,
        balanceAfter: balance,
        createdAt: payment.createdAt,
      });
    }
  }

  entries.sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id),
  );
  balance = 0;
  for (const entry of entries) {
    if (entry.entryType === "sale") {
      balance += entry.amount;
    } else {
      balance -= entry.amount;
    }
    entry.balanceAfter = balance;
  }

  return {
    customer: {
      id: row.id,
      name: row.name,
      phone: row.phone,
      address: row.address,
      customerType: row.customerType,
      creditLimit: safeInteger(row.creditLimit, "customer credit limit"),
    },
    totalSales,
    totalPayments,
    outstandingBalance: balance,
    entries,
  };
}
