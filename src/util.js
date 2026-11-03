class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseBody(schema, body) {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join('; ');
    throw new HttpError(400, msg);
  }
  return r.data;
}

const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID tidak valid.');
  return n;
};

async function logHistory(db, h) {
  await db.query(
    `INSERT INTO history (action, description, member_id, member_name, delta, points_before, points_after, actor_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [h.action, h.description, h.memberId ?? null, h.memberName ?? null, h.delta ?? null,
      h.before ?? null, h.after ?? null, h.actor]
  );
}

module.exports = { HttpError, wrap, parseBody, idParam, logHistory };
