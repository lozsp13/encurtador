const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_FILE = path.join(__dirname, 'data', 'links.json');

// Garante que a pasta data existe
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function carregarLinks() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function salvarLinks(links) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2));
}

// Criar link encurtado
app.post('/api/encurtar', (req, res) => {
  const { url, codigo } = req.body;

  if (!url) {
    return res.status(400).json({ erro: 'URL é obrigatória' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ erro: 'URL inválida' });
  }

  const links = carregarLinks();
  const chave = codigo?.trim() || crypto.randomBytes(3).toString('hex');

  if (links[chave] && !codigo) {
    // colisão improvável, gera outro
    const chave2 = crypto.randomBytes(3).toString('hex');
    links[chave2] = { url, criado: new Date().toISOString(), acessos: 0 };
    salvarLinks(links);
    return res.json({ codigo: chave2, curto: `${BASE_URL}/${chave2}` });
  }

  if (links[chave] && codigo) {
    return res.status(409).json({ erro: 'Código já está em uso, escolha outro' });
  }

  links[chave] = { url, criado: new Date().toISOString(), acessos: 0 };
  salvarLinks(links);
  res.json({ codigo: chave, curto: `${BASE_URL}/${chave}` });
});

// Listar todos os links
app.get('/api/links', (req, res) => {
  const links = carregarLinks();
  const lista = Object.entries(links).map(([codigo, dados]) => ({
    codigo,
    ...dados,
    curto: `${BASE_URL}/${codigo}`
  }));
  res.json(lista);
});

// Deletar um link
app.delete('/api/links/:codigo', (req, res) => {
  const links = carregarLinks();
  const { codigo } = req.params;
  if (!links[codigo]) {
    return res.status(404).json({ erro: 'Link não encontrado' });
  }
  delete links[codigo];
  salvarLinks(links);
  res.json({ mensagem: 'Link removido' });
});

// Redirecionar
app.get('/:codigo', (req, res) => {
  const links = carregarLinks();
  const entrada = links[req.params.codigo];
  if (!entrada) {
    return res.status(404).send('Link não encontrado');
  }
  entrada.acessos++;
  salvarLinks(links);
  res.redirect(entrada.url);
});

app.listen(PORT, () => {
  console.log(`Encurtador rodando em http://localhost:${PORT}`);
});
