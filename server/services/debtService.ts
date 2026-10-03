import crypto from 'crypto';
import { round3, addMoney, subtractMoney } from '../utils/money.js';

export interface CustomerPaymentInput {
  customerId: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
  date?: string;
}

export interface AllocationResult {
  payment_id: string;
  customer_id: string;
  amount_paid: number;
  amount_allocated: number;
  overpayment_wallet_credit: number;
  tickets_affected: {
    ticket_id: string;
    ticket_number: string;
    amount_allocated: number;
    previous_remaining: number;
    new_remaining: number;
    new_status: string;
  }[];
}

/**
 * Applies a customer payment against open debt tickets in FIFO order (oldest first).
 * If the payment exceeds total outstanding debt, the surplus is automatically deposited into the customer's wallet.
 */
export function allocateCustomerPayment(
  db: any,
  input: CustomerPaymentInput
): AllocationResult {
  const amount = round3(input.amount);
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(input.customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${input.customerId}`);
  }

  const paymentId = crypto.randomUUID();
  const date = input.date || new Date().toISOString();
  const now = new Date().toISOString();

  // Fetch open tickets oldest first
  const openTickets: any[] = db.prepare(`
    SELECT * FROM customer_debt_tickets
    WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    ORDER BY date ASC, created_at ASC
  `).all(input.customerId);

  let unallocated = amount;
  const ticketsAffected: AllocationResult['tickets_affected'] = [];

  const paymentTx = db.transaction(() => {
    // 1. Record customer payment
    db.prepare(`
      INSERT INTO customer_payments (id, customer_id, date, amount, payment_method, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      input.customerId,
      date,
      amount,
      input.paymentMethod || 'Cash',
      input.notes || '',
      now
    );

    const insertAllocation = db.prepare(`
      INSERT INTO customer_payment_allocations (id, payment_id, ticket_id, amount_allocated)
      VALUES (?, ?, ?, ?)
    `);

    const updateTicket = db.prepare(`
      UPDATE customer_debt_tickets
      SET remaining_amount = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `);

    // 2. Allocate to tickets FIFO
    for (const ticket of openTickets) {
      if (unallocated <= 0) break;

      const remaining = round3(ticket.remaining_amount);
      const toAllocate = Math.min(unallocated, remaining);
      const newRemaining = round3(remaining - toAllocate);
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

      insertAllocation.run(
        crypto.randomUUID(),
        paymentId,
        ticket.id,
        toAllocate
      );

      updateTicket.run(
        newRemaining,
        newStatus,
        now,
        ticket.id
      );

      ticketsAffected.push({
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        amount_allocated: toAllocate,
        previous_remaining: remaining,
        new_remaining: newRemaining,
        new_status: newStatus
      });

      unallocated = round3(unallocated - toAllocate);
    }

    // 3. Overpayment -> Deposit into wallet
    if (unallocated > 0) {
      db.prepare(`
        INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, reference_id, notes, created_at)
        VALUES (?, ?, ?, 'OVERPAYMENT_DEPOSIT', ?, ?, 'Overpayment debt surplus credit', ?)
      `).run(
        crypto.randomUUID(),
        input.customerId,
        date,
        unallocated,
        paymentId,
        now
      );

      db.prepare(`
        UPDATE customers
        SET wallet_balance = wallet_balance + ?,
            updated_at = ?
        WHERE id = ?
      `).run(unallocated, now, input.customerId);
    }
  });

  paymentTx();

  return {
    payment_id: paymentId,
    customer_id: input.customerId,
    amount_paid: amount,
    amount_allocated: round3(amount - unallocated),
    overpayment_wallet_credit: unallocated,
    tickets_affected: ticketsAffected
  };
}

/**
 * Checks if a ticket is overdue past the configured threshold in days (default: 30 days).
 */
export function isTicketOverdue(ticketDate: string, thresholdDays: number = 30): boolean {
  const diffMs = Date.now() - new Date(ticketDate).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= thresholdDays;
}

export interface SupplierPaymentInput {
  supplierId: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
  date?: string;
}

export interface SupplierAllocationResult {
  payment_id: string;
  supplier_id: string;
  amount_paid: number;
  amount_allocated: number;
  tickets_affected: {
    ticket_id: string;
    ticket_number: string;
    amount_allocated: number;
    previous_remaining: number;
    new_remaining: number;
    new_status: string;
  }[];
}

/**
 * Applies a payment to a supplier against their open debt tickets in FIFO order (oldest first).
 */
export function allocateSupplierPayment(
  db: any,
  input: SupplierPaymentInput
): SupplierAllocationResult {
  const amount = round3(input.amount);
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  const supplier: any = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(input.supplierId);
  if (!supplier) {
    throw new Error(`Supplier not found: ${input.supplierId}`);
  }

  const paymentId = crypto.randomUUID();
  const date = input.date || new Date().toISOString();
  const now = new Date().toISOString();

  // Fetch open supplier tickets oldest first
  const openTickets: any[] = db.prepare(`
    SELECT * FROM supplier_debt_tickets
    WHERE supplier_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    ORDER BY date ASC, created_at ASC
  `).all(input.supplierId);

  const totalOutstanding = round3(openTickets.reduce((sum: number, t: any) => sum + round3(t.remaining_amount), 0));
  if (amount > totalOutstanding) {
    throw new Error(`Payment amount (${amount.toFixed(3)} DT) exceeds supplier total outstanding debt (${totalOutstanding.toFixed(3)} DT)`);
  }

  let unallocated = amount;
  const ticketsAffected: SupplierAllocationResult['tickets_affected'] = [];

  const paymentTx = db.transaction(() => {
    // 1. Record supplier payment
    db.prepare(`
      INSERT INTO supplier_payments (id, supplier_id, date, amount, payment_method, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      input.supplierId,
      date,
      amount,
      input.paymentMethod || 'Cash',
      input.notes || '',
      now
    );

    const insertAllocation = db.prepare(`
      INSERT INTO supplier_payment_allocations (id, payment_id, ticket_id, amount_allocated)
      VALUES (?, ?, ?, ?)
    `);

    const updateTicket = db.prepare(`
      UPDATE supplier_debt_tickets
      SET remaining_amount = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `);

    // 2. Allocate to tickets FIFO
    for (const ticket of openTickets) {
      if (unallocated <= 0) break;

      const remaining = round3(ticket.remaining_amount);
      const toAllocate = Math.min(unallocated, remaining);
      const newRemaining = round3(remaining - toAllocate);
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

      insertAllocation.run(
        crypto.randomUUID(),
        paymentId,
        ticket.id,
        toAllocate
      );

      updateTicket.run(
        newRemaining,
        newStatus,
        now,
        ticket.id
      );

      ticketsAffected.push({
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        amount_allocated: toAllocate,
        previous_remaining: remaining,
        new_remaining: newRemaining,
        new_status: newStatus
      });

      unallocated = round3(unallocated - toAllocate);
    }
  });

  paymentTx();

  return {
    payment_id: paymentId,
    supplier_id: input.supplierId,
    amount_paid: amount,
    amount_allocated: round3(amount - unallocated),
    tickets_affected: ticketsAffected
  };
}

