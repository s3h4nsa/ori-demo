const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'shop.db');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nhehzncyhcditfrrcnag.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7ukY5lsqHvHiofPtiXg9_Q_gYjNKmZL';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('YOUR-PROJECT'));

fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database at', dbPath);
});

const initializeDatabase = () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      name TEXT,
      brand TEXT,
      cat TEXT,
      price TEXT,
      stock INTEGER DEFAULT 0,
      image TEXT,
      image_url TEXT,
      images TEXT,
      options TEXT,
      status TEXT DEFAULT 'Active',
      description TEXT,
      source_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      slug TEXT UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS hero_slides (
      id TEXT PRIMARY KEY,
      productSlug TEXT,
      eyebrow TEXT,
      title TEXT,
      description TEXT,
      image TEXT,
      theme TEXT DEFAULT 'custom',
      themeColor TEXT DEFAULT '#cdeaa4',
      price TEXT,
      href TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS discount_codes (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT,
      type TEXT,
      value REAL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      invoice_number TEXT,
      payload TEXT,
      issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  statements.forEach((sql) => {
    db.run(sql, (err) => {
      if (err) {
        console.error('Schema init error:', err.message);
      }
    });
  });

  const migrationSql = [
    "ALTER TABLE products ADD COLUMN brand TEXT",
    "ALTER TABLE products ADD COLUMN cat TEXT",
    "ALTER TABLE products ADD COLUMN image_url TEXT",
    "ALTER TABLE products ADD COLUMN images TEXT",
    "ALTER TABLE products ADD COLUMN options TEXT",
    "ALTER TABLE categories ADD COLUMN slug TEXT",
  ];

  migrationSql.forEach((statement) => {
    db.run(statement, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.warn('Schema migration warning:', err.message);
      }
    });
  });
};

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const first = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row || null);
  });
});

const parseJson = (value, fallback = []) => {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const generateUuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    const value = character === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
};

const supabaseRequest = async (path, options = {}) => {
  if (!USE_SUPABASE) throw new Error('Supabase not configured.');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...(options.headers || {})
  };

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined
      ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
      : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
};

const forwardedSupabaseHeaders = (req) => ({
  ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
});

const normalizeSupabaseProduct = (row, categoryMap = {}) => ({
  id: row.id,
  slug: row.slug || row.name || row.id,
  name: row.name || 'Product',
  brand: row.brand || 'Oriflame LK',
  cat: row.cat || categoryMap[row.category_id] || 'Makeup',
  price: row.price ?? 'Rs. 0',
  stock: Number(row.stock || 0),
  image: row.image_url || row.image || 'productImage.webp',
  images: parseJson(row.images, [row.image_url || row.image || 'productImage.webp']),
  options: parseJson(row.options, {}),
  status: row.status || (Number(row.stock || 0) <= 0 ? 'Out of stock' : 'Active'),
  description: row.description || '',
  sourceUrl: row.source_url || '',
  desc: row.description || `${row.name || 'Product'} is available from our ${row.cat || 'shop'} collection.`
});

const normalizeProduct = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  brand: row.brand,
  cat: row.cat,
  price: row.price,
  stock: Number(row.stock || 0),
  image: row.image_url || row.image || 'productImage.webp',
  images: parseJson(row.images, [row.image_url || row.image || 'productImage.webp']),
  options: parseJson(row.options, {}),
  status: row.status,
  description: row.description,
  sourceUrl: row.source_url,
  desc: row.description || `${row.name || 'Product'} is available from our ${row.cat || 'shop'} collection.`
});

const normalizeCategory = (row) => ({
  id: row.id || row.name || `cat-${Math.random().toString(16).slice(2)}`,
  slug: row.slug || (row.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || undefined,
  name: row.name || row.cat || 'Category',
  description: row.description || ''
});

const categoryNameFromProduct = (value) => {
  const raw = String(value || '').trim();
  return raw.replace(/\s+/g, ' ');
};

const normalizeHero = (row = {}) => ({
  id: row.id || row.hero_id || generateUuid(),
  productSlug: row.productSlug || row.productslug || '',
  eyebrow: row.eyebrow || '',
  title: row.title || 'Featured offer',
  description: row.description || '',
  image: row.image || row.image_url || 'productImage.webp',
  theme: row.theme || 'custom',
  themeColor: row.themeColor || row.themecolor || '#cdeaa4',
  price: row.price || 'Shop now',
  href: row.href || 'index.html'
});

const normalizeDiscount = (row) => ({
  id: row.id,
  code: row.code,
  title: row.title,
  type: row.type,
  value: Number(row.value || 0),
  active: Boolean(row.active)
});

const normalizeOrder = (row) => {
  try {
    return JSON.parse(row.payload || '{}');
  } catch {
    return {};
  }
};

const normalizeBill = (row) => {
  try {
    return { ...JSON.parse(row.payload || '{}'), id: row.id, orderId: row.order_id, invoiceNumber: row.invoice_number, issuedAt: row.issued_at };
  } catch {
    return { id: row.id, orderId: row.order_id, invoiceNumber: row.invoice_number, issuedAt: row.issued_at };
  }
};

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'oriflame-store' });
});

app.get('/api/products', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      try {
        const categoryRows = await supabaseRequest('/rest/v1/categories?select=*');
        const categoryMap = Object.fromEntries((categoryRows || []).map((row) => [row.id, row.name || row.slug || 'Makeup']));
        const rows = await supabaseRequest('/rest/v1/products?select=*');
        res.json((rows || []).map((row) => normalizeSupabaseProduct(row, categoryMap)));
        return;
      } catch (supabaseError) {
        console.warn('Supabase products unavailable; using SQLite:', supabaseError.message);
      }
    }

    const rows = await all('SELECT * FROM products ORDER BY updated_at DESC, created_at DESC');
    res.json(rows.map(normalizeProduct));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const product = req.body || {};
      const payload = {
        id: product.id || generateUuid(),
        name: product.name || 'Product',
        slug: product.slug || String(product.name || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        brand: product.brand || 'Oriflame LK',
        sku: product.sku || `SKU-${Date.now()}`,
        category_id: product.category_id || null,
        price: Number(String(product.price || 0).replace(/[^\d.-]/g, '')) || 0,
        stock: Number(product.stock || 0),
        image_url: product.image || product.image_url || 'productImage.webp',
        status: String(product.status || 'active').toLowerCase().replace(/\s+/g, '_'),
        description: product.description || product.desc || ''
      };
      const result = await supabaseRequest('/rest/v1/products', { method: 'POST', body: payload, headers: { Prefer: 'return=representation', ...forwardedSupabaseHeaders(req) }});
      res.json({ success: true, id: payload.id, data: result });
      return;
    }

    const product = req.body || {};
    const id = product.id || generateUuid();
    const slug = product.slug || product.name || id;
    const imageValue = product.image_url || product.image || 'productImage.webp';
    await run(
      `INSERT INTO products (id, slug, name, brand, cat, price, stock, image, image_url, images, options, status, description, source_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug,
         name = excluded.name,
         brand = excluded.brand,
         cat = excluded.cat,
         price = excluded.price,
         stock = excluded.stock,
         image = excluded.image,
         image_url = excluded.image_url,
         images = excluded.images,
         options = excluded.options,
         status = excluded.status,
         description = excluded.description,
         source_url = excluded.source_url,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        slug,
        product.name || 'Product',
        product.brand || 'Oriflame',
        product.cat || 'Skincare',
        product.price || 'Rs. 0',
        Number(product.stock || 0),
        imageValue,
        imageValue,
        JSON.stringify(Array.isArray(product.images) && product.images.length ? product.images : [imageValue]),
        JSON.stringify(product.options && typeof product.options === 'object' ? product.options : {}),
        product.status || 'Active',
        product.description || product.desc || '',
        product.sourceUrl || '',
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const product = req.body || {};
      const payload = {
        name: product.name || 'Product',
        slug: product.slug || String(product.name || req.params.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        brand: product.brand || 'Oriflame LK',
        sku: product.sku || `SKU-${Date.now()}`,
        category_id: product.category_id || null,
        price: Number(String(product.price || 0).replace(/[^\d.-]/g, '')) || 0,
        stock: Number(product.stock || 0),
        image_url: product.image || product.image_url || 'productImage.webp',
        status: String(product.status || 'active').toLowerCase().replace(/\s+/g, '_'),
        description: product.description || product.desc || ''
      };
      await supabaseRequest(`/rest/v1/products?id=eq.${req.params.id}`, { method: 'PATCH', body: payload, headers: forwardedSupabaseHeaders(req) });
      res.json({ success: true, id: req.params.id });
      return;
    }

    const product = req.body || {};
    const id = req.params.id;
    const nextSlug = product.slug || id;
    const imageValue = product.image_url || product.image || 'productImage.webp';
    await run(
      `UPDATE products SET
        slug = ?,
        name = ?,
        brand = ?,
        cat = ?,
        price = ?,
        stock = ?,
        image = ?,
        image_url = ?,
        images = ?,
        options = ?,
        status = ?,
        description = ?,
        source_url = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextSlug,
        product.name || 'Product',
        product.brand || 'Oriflame',
        product.cat || 'Skincare',
        product.price || 'Rs. 0',
        Number(product.stock || 0),
        imageValue,
        imageValue,
        JSON.stringify(Array.isArray(product.images) && product.images.length ? product.images : [imageValue]),
        JSON.stringify(product.options && typeof product.options === 'object' ? product.options : {}),
        product.status || 'Active',
        product.description || product.desc || '',
        product.sourceUrl || '',
        id
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/products?id=eq.${req.params.id}`, { method: 'DELETE' });
      res.json({ success: true });
      return;
    }

    await run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      try {
        const rows = await supabaseRequest('/rest/v1/categories?select=*');
        const categories = (rows || []).map((row) => normalizeCategory({ id: row.id, name: row.name || row.slug || 'Category', description: row.description || '' }));
        const seen = new Set();
        const list = [];
        for (const category of categories) {
          const name = categoryNameFromProduct(category.name);
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          list.push({ ...category, name });
        }
        res.json(list);
        return;
      } catch (supabaseError) {
        console.warn('Supabase categories unavailable; using SQLite:', supabaseError.message);
      }
    }

    const rows = await all('SELECT * FROM categories ORDER BY updated_at DESC');
    const categories = rows.map(normalizeCategory);
    const seen = new Set();
    const list = [];

    for (const category of categories) {
      const name = categoryNameFromProduct(category.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      list.push({ ...category, name });
    }

    if (!list.length) {
      const productRows = await all("SELECT DISTINCT cat FROM products WHERE TRIM(COALESCE(cat, '')) <> '' ORDER BY cat ASC");
      for (const row of productRows) {
        const name = categoryNameFromProduct(row.cat);
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        list.push({ id: `product-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, description: '' });
      }
    }

    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const category = req.body || {};
    const id = category.id || category.slug || category.name || `cat-${Date.now()}`;
    const slug = category.slug || (category.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || id;
    if (USE_SUPABASE) {
      const payload = { id, name: category.name || 'Category', slug, description: category.description || '' };
      const result = await supabaseRequest('/rest/v1/categories', {
        method: 'POST',
        body: payload,
        headers: { Prefer: 'return=representation' }
      });
      res.json({ success: true, id, slug, data: result });
      return;
    }
    await run(
      `INSERT INTO categories (id, name, slug, description, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         description = excluded.description,
         updated_at = CURRENT_TIMESTAMP`,
      [id, category.name || 'Category', slug, category.description || '']
    );
    res.json({ success: true, id, slug });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const category = req.body || {};
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/categories?id=eq.${encodeURIComponent(req.params.id)}`, {
        method: 'PATCH',
        body: {
          name: category.name || 'Category',
          slug: category.slug || (category.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          description: category.description || ''
        }
      });
      res.json({ success: true, id: req.params.id });
      return;
    }
    await run(
      'UPDATE categories SET name = ?, slug = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        category.name || 'Category',
        category.slug || (category.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        category.description || '',
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/categories?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
      res.json({ success: true });
      return;
    }
    await run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/hero', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest('/rest/v1/hero_slides?select=*');
      res.json((rows || []).map(normalizeHero));
      return;
    }
    const rows = await all('SELECT * FROM hero_slides ORDER BY updated_at DESC');
    res.json(rows.map(normalizeHero));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/hero', async (req, res) => {
  try {
    const hero = req.body || {};
    const id = hero.id || generateUuid();
    if (USE_SUPABASE) {
      await supabaseRequest('/rest/v1/hero_slides', { method: 'POST', body: {
        id,
        productslug: hero.productSlug || hero.productslug || '',
        eyebrow: hero.eyebrow || '',
        title: hero.title || 'Featured offer',
        description: hero.description || '',
        image: hero.image || 'productImage.webp',
        theme: hero.theme || 'custom',
        themecolor: hero.themeColor || hero.themecolor || '#cdeaa4',
        price: hero.price || 'Shop now',
        href: hero.href || 'index.html'
      }, headers: forwardedSupabaseHeaders(req) });
      res.json({ success: true, id });
      return;
    }
    await run(
      `INSERT INTO hero_slides (id, productSlug, eyebrow, title, description, image, theme, themeColor, price, href, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         productSlug = excluded.productSlug,
         eyebrow = excluded.eyebrow,
         title = excluded.title,
         description = excluded.description,
         image = excluded.image,
         theme = excluded.theme,
         themeColor = excluded.themeColor,
         price = excluded.price,
         href = excluded.href,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        hero.productSlug || '',
        hero.eyebrow || '',
        hero.title || 'Featured offer',
        hero.description || '',
        hero.image || 'productImage.webp',
        hero.theme || 'custom',
        hero.themeColor || '#cdeaa4',
        hero.price || 'Shop now',
        hero.href || 'index.html'
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/hero/:id', async (req, res) => {
  try {
    const hero = req.body || {};
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/hero_slides?id=eq.${encodeURIComponent(req.params.id)}`, {
        method: 'PATCH',
        body: {
          productslug: hero.productSlug || hero.productslug || '',
          eyebrow: hero.eyebrow || '',
          title: hero.title || 'Featured offer',
          description: hero.description || '',
          image: hero.image || 'productImage.webp',
          theme: hero.theme || 'custom',
          themecolor: hero.themeColor || hero.themecolor || '#cdeaa4',
          price: hero.price || 'Shop now',
          href: hero.href || 'index.html'
        },
        headers: forwardedSupabaseHeaders(req)
      });
      res.json({ success: true, id: req.params.id });
      return;
    }
    await run(
      `UPDATE hero_slides SET
        productSlug = ?,
        eyebrow = ?,
        title = ?,
        description = ?,
        image = ?,
        theme = ?,
        themeColor = ?,
        price = ?,
        href = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        hero.productSlug || '',
        hero.eyebrow || '',
        hero.title || 'Featured offer',
        hero.description || '',
        hero.image || 'productImage.webp',
        hero.theme || 'custom',
        hero.themeColor || '#cdeaa4',
        hero.price || 'Shop now',
        hero.href || 'index.html',
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/hero/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/hero_slides?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
      res.json({ success: true });
      return;
    }
    await run('DELETE FROM hero_slides WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/discounts', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest('/rest/v1/discount_codes?select=*');
      res.json((rows || []).map(normalizeDiscount));
      return;
    }
    const rows = await all('SELECT * FROM discount_codes ORDER BY updated_at DESC');
    res.json(rows.map(normalizeDiscount));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/discounts', async (req, res) => {
  try {
    const code = req.body || {};
    const id = code.id || generateUuid();
    if (USE_SUPABASE) {
      await supabaseRequest('/rest/v1/discount_codes', { method: 'POST', body: { id, code: (code.code || '').toUpperCase(), title: code.title || '', type: code.type || 'percent', value: Number(code.value || 0), active: !!code.active } });
      res.json({ success: true, id });
      return;
    }
    await run(
      `INSERT INTO discount_codes (id, code, title, type, value, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         title = excluded.title,
         type = excluded.type,
         value = excluded.value,
         active = excluded.active,
         updated_at = CURRENT_TIMESTAMP`,
      [id, (code.code || '').toUpperCase(), code.title || '', code.type || 'percent', Number(code.value || 0), code.active ? 1 : 0]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/discounts/:id', async (req, res) => {
  try {
    const code = req.body || {};
    await run(
      'UPDATE discount_codes SET code = ?, title = ?, type = ?, value = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [(code.code || '').toUpperCase(), code.title || '', code.type || 'percent', Number(code.value || 0), code.active ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/discounts/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      await supabaseRequest(`/rest/v1/discount_codes?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
      res.json({ success: true });
      return;
    }
    await run('DELETE FROM discount_codes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM orders ORDER BY updated_at DESC');
    res.json(rows.map(normalizeOrder));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body || {};
    const id = order.id || `OLK-${Date.now()}`;
    await run(
      `INSERT INTO orders (id, payload, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = CURRENT_TIMESTAMP`,
      [id, JSON.stringify(order)]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const order = req.body || {};
    await run('UPDATE orders SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(order), req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    await run('DELETE FROM orders WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/bills', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM bills ORDER BY issued_at DESC');
    res.json(rows.map(normalizeBill));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/bills', async (req, res) => {
  try {
    const bill = req.body || {};
    const id = bill.id || `INV-${Date.now()}`;
    const orderId = bill.orderId || bill.order_id || bill.order || '';
    const invoiceNumber = bill.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
    await run(
      `INSERT INTO bills (id, order_id, invoice_number, payload, issued_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         order_id = excluded.order_id,
         invoice_number = excluded.invoice_number,
         payload = excluded.payload,
         issued_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [id, orderId, invoiceNumber, JSON.stringify(bill)]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/bills/:id', async (req, res) => {
  try {
    const bill = req.body || {};
    await run(
      'UPDATE bills SET order_id = ?, invoice_number = ?, payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [bill.orderId || bill.order_id || bill.order || '', bill.invoiceNumber || '', JSON.stringify(bill), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/bills/:id', async (req, res) => {
  try {
    await run('DELETE FROM bills WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/collections/:collection', async (req, res) => {
  try {
    const collection = String(req.params.collection || '').toLowerCase();
    const payload = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
    const collectionMap = {
      products: 'products',
      inventory: 'products',
      categories: 'categories',
      hero: 'hero_slides',
      heroes: 'hero_slides',
      discounts: 'discount_codes',
      orders: 'orders',
      bills: 'bills'
    };
    const target = collectionMap[collection];
    if (!target) {
      return res.status(400).json({ message: 'Unsupported collection.' });
    }

    if (USE_SUPABASE) {
      const tableName = target === 'products' ? 'products' : target === 'categories' ? 'categories' : target === 'hero_slides' ? 'hero_slides' : target === 'discount_codes' ? 'discount_codes' : target;
      await supabaseRequest(`/rest/v1/${tableName}?select=*`, { method: 'GET' });
      for (const item of payload) {
        const existing = await supabaseRequest(`/rest/v1/${tableName}?select=*`);
        const match = existing.find((row) => row.id === (item.id || row.id));
        const requestBody = {
          id: item.id || item.slug || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ...item,
          slug: item.slug || item.name || item.id || `local-${Date.now()}`,
          name: item.name || item.title || 'Product',
          price: item.price || item.value || 'Rs. 0',
          stock: Number(item.stock || 0),
          image_url: item.image_url || item.image || 'productImage.webp',
          images: JSON.stringify(Array.isArray(item.images) && item.images.length ? item.images : [item.image_url || item.image || 'productImage.webp']),
          options: JSON.stringify(item.options && typeof item.options === 'object' ? item.options : {}),
          description: item.description || item.desc || '',
          status: item.status || 'Active',
          code: (item.code || '').toUpperCase(),
          value: Number(item.value || item.price || 0),
          active: item.active !== false,
          title: item.title || item.name || 'Offer',
          href: item.href || 'index.html',
          themeColor: item.themeColor || '#cdeaa4'
        };
        if (match) {
          await supabaseRequest(`/rest/v1/${tableName}?id=eq.${match.id}`, { method: 'PATCH', body: requestBody });
        } else {
          await supabaseRequest(`/rest/v1/${tableName}`, { method: 'POST', body: requestBody });
        }
      }
      res.json({ success: true });
      return;
    }

    if (target === 'products') {
      await run('DELETE FROM products');
      for (const item of payload) {
        const id = item.id || item.slug || `prod-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await run(
          `INSERT INTO products (id, slug, name, brand, cat, price, stock, image, images, options, status, description, source_url, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [id, item.slug || id, item.name || 'Product', item.brand || 'Oriflame', item.cat || 'Skincare', item.price || 'Rs. 0', Number(item.stock || 0), item.image || 'productImage.webp', JSON.stringify(Array.isArray(item.images) && item.images.length ? item.images : [item.image || 'productImage.webp']), JSON.stringify(item.options && typeof item.options === 'object' ? item.options : {}), item.status || 'Active', item.description || item.desc || '', item.sourceUrl || '']
        );
      }
    }

    if (target === 'categories') {
      await run('DELETE FROM categories');
      for (const item of payload) {
        const id = item.id || item.name || `cat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await run('INSERT INTO categories (id, name, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [id, item.name || 'Category', item.description || '']);
      }
    }

    if (target === 'hero_slides') {
      await run('DELETE FROM hero_slides');
      for (const item of payload) {
        const id = item.id || `hero-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await run(
          'INSERT INTO hero_slides (id, productSlug, eyebrow, title, description, image, theme, themeColor, price, href, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [id, item.productSlug || '', item.eyebrow || '', item.title || 'Featured offer', item.description || '', item.image || 'productImage.webp', item.theme || 'custom', item.themeColor || '#cdeaa4', item.price || 'Shop now', item.href || 'index.html']
        );
      }
    }

    if (target === 'discount_codes') {
      await run('DELETE FROM discount_codes');
      for (const item of payload) {
        const id = item.id || `disc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await run(
          'INSERT INTO discount_codes (id, code, title, type, value, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [id, (item.code || '').toUpperCase(), item.title || '', item.type || 'percent', Number(item.value || 0), item.active ? 1 : 0]
        );
      }
    }

    if (target === 'orders') {
      await run('DELETE FROM orders');
      for (const item of payload) {
        const id = item.id || `OLK-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await run('INSERT INTO orders (id, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [id, JSON.stringify(item)]);
      }
    }

    if (target === 'bills') {
      await run('DELETE FROM bills');
      for (const item of payload) {
        const id = item.id || `INV-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const orderId = item.orderId || item.order_id || item.order || '';
        const invoiceNumber = item.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
        await run('INSERT INTO bills (id, order_id, invoice_number, payload, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', [id, orderId, invoiceNumber, JSON.stringify(item)]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.use(express.static(rootDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const safeFile = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const filePath = path.join(rootDir, safeFile);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
    return;
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

initializeDatabase();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
