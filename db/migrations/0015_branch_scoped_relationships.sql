ALTER TABLE suppliers
  ADD COLUMN branch_id UUID,
  ADD CONSTRAINT suppliers_business_branch_fk
    FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id);

CREATE INDEX suppliers_branch_directory_idx
  ON suppliers (business_id, branch_id, is_active DESC, lower(name), id);

ALTER TABLE customers
  ADD COLUMN branch_id UUID,
  ADD CONSTRAINT customers_business_branch_fk
    FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id);

CREATE INDEX customers_branch_directory_idx
  ON customers (business_id, branch_id, is_active DESC, lower(name), id);
