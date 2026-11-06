// Bonuses are credited only by an authenticated administrator.
export async function createManualBonuses(ctx) {
  const { db, one, run, tx, credit, fail, audit } = ctx;
  (await db.exec(`CREATE TABLE IF NOT EXISTS manual_bonus_credits(
    id INTEGER PRIMARY KEY,
    request_key TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    admin_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    loss_amount INTEGER,
    note TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  )`));

  return async function addBonus(data, admin) {
    if (admin?.role !== 'admin' || admin.blocked) fail('Admin access required', 403);
    const id = Number(data.id);
    const kind = data.kind;
    const amount = data.amount;
    const note = String(data.note || '').trim().slice(0, 300);
    const key = String(data.requestKey || '');
    const loss = kind === 'LOSING' ? data.lossAmount : null;
    if (!Number.isSafeInteger(id) || id < 1) fail('Choose a customer.');
    if (!['WELCOME', 'PROMO', 'LOSING'].includes(kind)) fail('Choose a valid bonus type.');
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 25000) fail('Bonus amount must be a whole amount from ₹1 to ₹25,000.');
    if (!note) fail('Enter an admin bonus note.');
    if (!/^[a-f0-9-]{36}$/i.test(key)) fail('Invalid bonus request key. Reopen the form.');
    if (kind === 'LOSING' && (!Number.isSafeInteger(loss) || loss < 10000 || loss > 1000000000)) {
      fail('Enter the reviewed loss amount, ₹10,000 or more.');
    }
    return (await tx(async () => {
      const previous = (await one('SELECT * FROM manual_bonus_credits WHERE request_key=?', key));
      if (previous) {
        if (previous.user_id !== id || previous.admin_id !== admin.id || previous.kind !== kind || previous.amount !== amount || previous.loss_amount !== loss || previous.note !== note) {
          fail('This request key was already used for a different bonus.', 409);
        }
        return { id: previous.id, alreadyAdded: true };
      }
      if (!(await one("SELECT id FROM users WHERE id=? AND role='customer'", id))) fail('Customer not found.');
      const result = (await run(`INSERT INTO manual_bonus_credits(
        request_key,user_id,admin_id,kind,amount,loss_amount,note
      ) VALUES(?,?,?,?,?,?,?)`, key, id, admin.id, kind, amount, loss, note));
      (await credit(id, amount, 'Manual ' + kind.toLowerCase() + ' bonus'));
      (await audit(admin.id, 'MANUAL_' + kind + '_BONUS', id,
        `Amount: ₹${amount}; reviewed loss: ${loss === null ? 'N/A' : '₹' + loss}; ${note}`));
      return { id: Number(result.lastInsertRowid), alreadyAdded: false };
    }));
  };
}
