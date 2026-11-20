import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the PostgreSQL integration test.");
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.WEB_BASE_URL = "http://localhost:3000";

const [
  { getDatabasePool },
  { withTransaction },
  { createBusiness },
  { createBranch },
  { createAdminUser, createManagerUser },
  { seedDefaultManagerPermissions },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: getSuppliers, POST: postSupplier },
  { PATCH: patchSupplier },
  { GET: getCustomers, POST: postCustomer },
  { PATCH: patchCustomer },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/suppliers/route.ts"),
  import("../../src/app/api/suppliers/[supplierId]/route.ts"),
  import("../../src/app/api/customers/route.ts"),
  import("../../src/app/api/customers/[customerId]/route.ts"),
]);

test("supplier and customer directories preserve tenant scope, permissions and credit precision", async () => {
  const pool = getDatabasePool();
  const businessIds = [];
  const sessionHashes = [];
  const unique = String(Date.now());
  const cookieName = authSessionCookieName();
  const originHeaders = {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  };
  let businessOneId;
  let branchId;
  let secondaryBranchId;
  let businessTwoBranchId;
  let legacySupplierId;
  let legacyCustomerId;
  let adminOneToken;
  let managerToken;
  let adminTwoToken;

  function authenticatedRequest(path, token, options = {}) {
    return new NextRequest(`http://localhost:3000${path}`, {
      ...options,
      headers: {
        Cookie: `${cookieName}=${token}`,
        ...(options.method === "GET" ? {} : originHeaders),
        ...options.headers,
      },
    });
  }

  try {
    await withTransaction(async (client) => {
      const businessOne = await createBusiness(client, { name: `Relationships ${unique}` });
      businessOneId = businessOne.id;
      businessIds.push(businessOne.id);
      const adminOne = await createAdminUser(client, {
        businessId: businessOne.id,
        username: `rel.admin.${unique.slice(-8)}`,
        fullName: "Relationships Admin",
        email: `relationships-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessOne.id, adminOne.id],
      );
      const branch = await createBranch(client, businessOne.id, { name: "Relationships branch" }, true);
      branchId = branch.id;
      const secondaryBranch = await createBranch(client, businessOne.id, { name: "Other relationships branch" }, true);
      secondaryBranchId = secondaryBranch.id;
      const manager = await createManagerUser(client, {
        businessId: businessOne.id,
        branchId: branch.id,
        username: `rel.manager.${unique.slice(-8)}`,
        fullName: "Relationships Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, businessOne.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = FALSE
         WHERE business_id = $1
           AND permission_id IN (
             'suppliers.read', 'suppliers.manage', 'customers.read', 'customers.manage'
           )`,
        [businessOne.id],
      );
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('suppliers.read', 'customers.read')`,
        [businessOne.id],
      );

      const businessTwo = await createBusiness(client, { name: `Other relationships ${unique}` });
      businessIds.push(businessTwo.id);
      const businessTwoBranch = await createBranch(client, businessTwo.id, { name: "Other business branch" }, true);
      businessTwoBranchId = businessTwoBranch.id;
      const adminTwo = await createAdminUser(client, {
        businessId: businessTwo.id,
        username: `rel.other.${unique.slice(-8)}`,
        fullName: "Other Relationships Admin",
        email: `relationships-other-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessTwo.id, adminTwo.id],
      );

      for (const [userId, token, businessId] of [
        [adminOne.id, createOpaqueToken(), businessOne.id],
        [manager.id, createOpaqueToken(), businessOne.id],
        [adminTwo.id, createOpaqueToken(), businessTwo.id],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        if (userId === adminOne.id) adminOneToken = token;
        if (userId === manager.id) managerToken = token;
        if (userId === adminTwo.id) adminTwoToken = token;
      }
    });

    assert.equal(
      (await getSuppliers(new NextRequest("http://localhost:3000/api/suppliers"))).status,
      401,
    );

    const supplierCreateResponse = await postSupplier(
      authenticatedRequest("/api/suppliers", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          businessId: "00000000-0000-4000-8000-000000000001",
          branchId,
          name: "  Kigali Building Supplies  ",
          contactPerson: "  Aline  ",
          phone: "0788000000",
          email: "supplies@example.test",
          address: "",
          taxId: "123456789",
        }),
      }),
    );
    assert.equal(supplierCreateResponse.status, 201);
    const supplier = (await supplierCreateResponse.json()).supplier;
    assert.equal(supplier.business_id, businessOneId);
    assert.equal(supplier.name, "Kigali Building Supplies");
    assert.equal(supplier.contact_person, "Aline");
    assert.equal(supplier.address, null);
    await pool.query(
      `INSERT INTO suppliers (business_id, branch_id, name)
       VALUES ($1, $2, 'Secondary branch supplier')`,
      [businessOneId, secondaryBranchId],
    );
    const legacySupplier = await pool.query(
      `INSERT INTO suppliers (business_id, name)
       VALUES ($1, 'Unassigned legacy supplier')
       RETURNING id`,
      [businessOneId],
    );
    legacySupplierId = legacySupplier.rows[0].id;

    const supplierListResponse = await getSuppliers(
      authenticatedRequest(`/api/suppliers?branchId=${branchId}`, adminOneToken),
    );
    assert.equal(supplierListResponse.status, 200);
    assert.equal((await supplierListResponse.json()).suppliers[0].id, supplier.id);
    assert.deepEqual(
      (await (await getSuppliers(authenticatedRequest(`/api/suppliers?branchId=${businessTwoBranchId}`, adminTwoToken))).json()).suppliers,
      [],
    );
    const secondarySupplierList = await getSuppliers(
      authenticatedRequest(`/api/suppliers?branchId=${secondaryBranchId}`, adminOneToken),
    );
    assert.equal((await secondarySupplierList.json()).suppliers[0].name, "Secondary branch supplier");

    const readOnlySupplierList = await getSuppliers(
      authenticatedRequest(`/api/suppliers?branchId=${branchId}`, managerToken),
    );
    assert.equal(readOnlySupplierList.status, 200);
    assert.equal((await readOnlySupplierList.json()).suppliers.length, 1);
    const readOnlySupplierCreate = await postSupplier(
      authenticatedRequest("/api/suppliers", managerToken, {
        method: "POST",
        body: JSON.stringify({ branchId, name: "Forbidden supplier" }),
      }),
    );
    assert.equal(readOnlySupplierCreate.status, 403);
    assert.equal(
      (await getSuppliers(authenticatedRequest(`/api/suppliers?branchId=${secondaryBranchId}`, managerToken))).status,
      403,
    );

    await pool.query(
      `UPDATE business_manager_permissions
       SET enabled = TRUE
       WHERE business_id = $1 AND permission_id IN ('suppliers.manage', 'customers.manage')`,
      [businessOneId],
    );
    const supplierUpdateResponse = await patchSupplier(
      authenticatedRequest(`/api/suppliers/${supplier.id}`, managerToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Kigali Building Supplies",
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxId: null,
          isActive: false,
        }),
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    assert.equal(supplierUpdateResponse.status, 200);
    assert.equal((await supplierUpdateResponse.json()).supplier.is_active, false);
    const managerLegacySupplierUpdate = await patchSupplier(
      authenticatedRequest(`/api/suppliers/${legacySupplierId}`, managerToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Unassigned legacy supplier",
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxId: null,
          isActive: true,
        }),
      }),
      { params: Promise.resolve({ supplierId: legacySupplierId }) },
    );
    assert.equal(managerLegacySupplierUpdate.status, 404);
    const adminLegacySupplierUpdate = await patchSupplier(
      authenticatedRequest(`/api/suppliers/${legacySupplierId}`, adminOneToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Assigned legacy supplier",
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxId: null,
          isActive: true,
        }),
      }),
      { params: Promise.resolve({ supplierId: legacySupplierId }) },
    );
    assert.equal(adminLegacySupplierUpdate.status, 200);
    assert.equal((await adminLegacySupplierUpdate.json()).supplier.branch_id, branchId);

    const customerCreateResponse = await postCustomer(
      authenticatedRequest("/api/customers", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          name: "Aline Mukamana",
          phone: "0788111222",
          address: "Kigali",
          customerType: "individual",
          creditLimit: 12345,
        }),
      }),
    );
    assert.equal(customerCreateResponse.status, 201);
    const customer = (await customerCreateResponse.json()).customer;
    assert.equal(customer.business_id, businessOneId);
    assert.equal(customer.credit_limit, 12345);
    assert.equal(customer.customer_type, "individual");
    await pool.query(
      `INSERT INTO customers (business_id, branch_id, name, credit_limit)
       VALUES ($1, $2, 'Secondary branch customer', 1000)`,
      [businessOneId, secondaryBranchId],
    );
    const legacyCustomer = await pool.query(
      `INSERT INTO customers (business_id, name, credit_limit)
       VALUES ($1, 'Unassigned legacy customer', 1000)
       RETURNING id`,
      [businessOneId],
    );
    legacyCustomerId = legacyCustomer.rows[0].id;

    const customerListResponse = await getCustomers(
      authenticatedRequest(`/api/customers?branchId=${branchId}`, adminOneToken),
    );
    assert.equal(customerListResponse.status, 200);
    assert.equal((await customerListResponse.json()).customers[0].credit_limit, 12345);
    assert.deepEqual(
      (await (await getCustomers(authenticatedRequest(`/api/customers?branchId=${businessTwoBranchId}`, adminTwoToken))).json()).customers,
      [],
    );
    const secondaryCustomerList = await getCustomers(
      authenticatedRequest(`/api/customers?branchId=${secondaryBranchId}`, adminOneToken),
    );
    assert.equal((await secondaryCustomerList.json()).customers[0].name, "Secondary branch customer");
    assert.equal(
      (await getCustomers(authenticatedRequest(`/api/customers?branchId=${secondaryBranchId}`, managerToken))).status,
      403,
    );

    const invalidCustomerResponse = await postCustomer(
      authenticatedRequest("/api/customers", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          name: "Invalid credit",
          customerType: "individual",
          creditLimit: -1,
        }),
      }),
    );
    assert.equal(invalidCustomerResponse.status, 400);

    const customerUpdateResponse = await patchCustomer(
      authenticatedRequest(`/api/customers/${customer.id}`, managerToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Aline Mukamana",
          phone: "0788111222",
          address: "Kigali",
          customerType: "business",
          creditLimit: 67890,
          isActive: false,
        }),
      }),
      { params: Promise.resolve({ customerId: customer.id }) },
    );
    assert.equal(customerUpdateResponse.status, 200);
    const updatedCustomer = (await customerUpdateResponse.json()).customer;
    assert.equal(updatedCustomer.customer_type, "business");
    assert.equal(updatedCustomer.credit_limit, 67890);
    assert.equal(updatedCustomer.is_active, false);
    const managerLegacyCustomerUpdate = await patchCustomer(
      authenticatedRequest(`/api/customers/${legacyCustomerId}`, managerToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Unassigned legacy customer",
          phone: null,
          address: null,
          customerType: "individual",
          creditLimit: 1000,
          isActive: true,
        }),
      }),
      { params: Promise.resolve({ customerId: legacyCustomerId }) },
    );
    assert.equal(managerLegacyCustomerUpdate.status, 404);
    const adminLegacyCustomerUpdate = await patchCustomer(
      authenticatedRequest(`/api/customers/${legacyCustomerId}`, adminOneToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Assigned legacy customer",
          phone: null,
          address: null,
          customerType: "individual",
          creditLimit: 1000,
          isActive: true,
        }),
      }),
      { params: Promise.resolve({ customerId: legacyCustomerId }) },
    );
    assert.equal(adminLegacyCustomerUpdate.status, 200);
    assert.equal((await adminLegacyCustomerUpdate.json()).customer.branch_id, branchId);

    const foreignCustomerUpdate = await patchCustomer(
      authenticatedRequest(`/api/customers/${customer.id}`, adminTwoToken, {
        method: "PATCH",
        body: JSON.stringify({
          branchId,
          name: "Foreign edit",
          phone: null,
          address: null,
          customerType: "individual",
          creditLimit: 0,
          isActive: true,
        }),
      }),
      { params: Promise.resolve({ customerId: customer.id }) },
    );
    assert.equal(foreignCustomerUpdate.status, 404);

    const auditResult = await pool.query(
      `SELECT action
       FROM audit_logs
       WHERE business_id = $1
         AND action IN (
           'suppliers.supplier_created',
           'suppliers.supplier_updated',
           'customers.customer_created',
           'customers.customer_updated'
         )`,
      [businessOneId],
    );
    assert.deepEqual(
      auditResult.rows.map((row) => row.action).sort(),
      [
        "customers.customer_created",
        "customers.customer_updated",
        "customers.customer_updated",
        "suppliers.supplier_created",
        "suppliers.supplier_updated",
        "suppliers.supplier_updated",
      ],
    );
  } finally {
    if (sessionHashes.length > 0) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM suppliers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
