const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Banco de dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      codigo VARCHAR(50) PRIMARY KEY,
      url TEXT NOT NULL,
      criado TIMESTAMP DEFAULT NOW(),
      acessos INTEGER DEFAULT 0
    )
  `);
}

function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 dias
}));

// Middleware de autenticação (não protege login e redirecionamentos)
function autenticado(req, res, next) {
  if (req.session.logado) return next();
  res.redirect('/login');
}

// --- Rotas públicas ---

// Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (req.body.senha === ADMIN_PASSWORD) {
    req.session.logado = true;
    return res.redirect('/');
  }
  res.redirect('/login?erro=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Redirecionar link curto (público — qualquer um pode usar o link)
app.get('/:codigo', async (req, res, next) => {
  if (req.params.codigo === 'login' || req.params.codigo === 'logout') return next();
  try {
    const result = await pool.query('SELECT url FROM links WHERE codigo = $1', [req.params.codigo]);
    if (result.rows.length === 0) return res.status(404).send('Link não encontrado');
    await pool.query('UPDATE links SET acessos = acessos + 1 WHERE codigo = $1', [req.params.codigo]);
    res.redirect(result.rows[0].url);
  } catch (err) {
    res.status(500).send('Erro interno');
  }
});

// --- Rotas protegidas ---

app.use(autenticado);
app.use(express.static(path.join(__dirname, 'public')));

// Criar link encurtado
app.post('/api/encurtar', async (req, res) => {
  const { url, codigo } = req.body;

  if (!url) return res.status(400).json({ erro: 'URL é obrigatória' });

  try { new URL(url); } catch {
    return res.status(400).json({ erro: 'URL inválida' });
  }

  const chave = codigo?.trim() || crypto.randomBytes(3).toString('hex');

  try {
    await pool.query(
      'INSERT INTO links (codigo, url) VALUES ($1, $2)',
      [chave, url]
    );
    res.json({ codigo: chave, curto: `${getBaseUrl(req)}/${chave}` });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ erro: 'Código já está em uso, escolha outro' });
    }
    res.status(500).json({ erro: 'Erro ao salvar link' });
  }
});

// Listar links
app.get('/api/links', async (req, res) => {
  const result = await pool.query('SELECT * FROM links ORDER BY criado DESC');
  const lista = result.rows.map(r => ({
    ...r,
    curto: `${getBaseUrl(req)}/${r.codigo}`
  }));
  res.json(lista);
});

// Deletar link
app.delete('/api/links/:codigo', async (req, res) => {
  const result = await pool.query('DELETE FROM links WHERE codigo = $1 RETURNING codigo', [req.params.codigo]);
  if (result.rowCount === 0) return res.status(404).json({ erro: 'Link não encontrado' });
  res.json({ mensagem: 'Link removido' });
});

// Inicializa banco e sobe servidor
initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`)))
  .catch(err => { console.error('Erro ao iniciar banco:', err); process.exit(1); });
