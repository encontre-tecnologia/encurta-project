const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();
const axios = require("axios");

const app = express();
const port = 8080;

app.use(bodyParser.json());
app.use(cors());

const pool = new Pool({
  connectionString:
    "postgresql://postgres:%40Tonystark19@db.dnqftoqeehvksonawiis.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

// Conecta no banco (debug)
pool.connect((err) => {
  if (err) console.error("Erro ao conectar ao Supabase:", err);
  else console.log("✅ Conectado ao Supabase");
});

// const GOOGLE_API_KEY = "AIzaSyBj5jmi5RbRsB8Lluysuu0jNvkPzgDw8DE";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error("⚠️  Variável de ambiente GOOGLE_MAPS_API_KEY não definida!");
  process.exit(1);
}

// <<< INÍCIO DA LÓGICA DE OTIMIZAÇÃO MOVIDA PARA O BACK-END >>>

function haversine(p1, p2) {
  const R = 6371; // Raio da Terra em km
  const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
  const dLng = ((p2.longitude - p1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.latitude * Math.PI) / 180) *
      Math.cos((p2.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcularDistanciaTotal(route, startPoint) {
  let distancia = 0;
  const percursoCompleto = [startPoint, ...route];
  if (percursoCompleto.length < 2) return 0;

  for (let i = 0; i < percursoCompleto.length - 1; i++) {
    distancia += haversine(percursoCompleto[i], percursoCompleto[i + 1]);
  }
  return distancia;
}

function otimizarParadas(stops, startPoint) {
  if (stops.length < 2) return stops;

  let melhorRota = [...stops];
  let melhorou = true;

  while (melhorou) {
    melhorou = false;
    let melhorDistancia = calcularDistanciaTotal(melhorRota, startPoint);

    for (let i = 0; i < melhorRota.length - 1; i++) {
      for (let j = i + 1; j < melhorRota.length; j++) {
        const novaRota = [...melhorRota];
        const segmento = novaRota.slice(i, j + 1).reverse();
        novaRota.splice(i, segmento.length, ...segmento);

        const novaDistancia = calcularDistanciaTotal(novaRota, startPoint);

        if (novaDistancia < melhorDistancia) {
          melhorRota = novaRota;
          melhorDistancia = novaDistancia;
          melhorou = true;
        }
      }
    }
  }
  return melhorRota;
}

// <<< FIM DA LÓGICA DE OTIMIZAÇÃO >>>

// <<< FUNÇÃO AUXILIAR DE GEOCODIFICAÇÃO REUTILIZÁVEL >>>
async function getGeocode(address, client) {
  const addressTrimmed = address.trim();
  console.log(`🔎 Processando endereço: ${addressTrimmed}`);

  // 1. Verifica se já existe no banco (por texto original)
  const { rows: existingRows } = await client.query(
    "SELECT endereco, latitude, longitude FROM public.enderecos_geocode WHERE endereco = $1 LIMIT 1",
    [addressTrimmed]
  );

  if (existingRows.length > 0) {
    console.log(`✅ Endereço encontrado no banco: ${addressTrimmed}`);
    return existingRows[0];
  }

  // 2. Se não existir, consulta no Google
  console.log(`❌ Não encontrado. Buscando no Google Maps: ${addressTrimmed}`);

  const url = "https://maps.googleapis.com/maps/api/geocode/json";
  const response = await axios.get(url, {
    params: { address: addressTrimmed, key: GOOGLE_MAPS_API_KEY },
  });

  if (response.data.status !== "OK") {
    throw new Error(`Erro da API do Google: ${response.data.status}`);
  }

  const result = response.data.results[0];
  const formatted = result.formatted_address;
  const location = result.geometry.location;

  const geocodeData = {
    endereco: formatted,
    latitude: location.lat,
    longitude: location.lng,
  };

  // 3. Tenta inserir (mas se já existir, pega do banco)
  const insertQuery = `
    INSERT INTO public.enderecos_geocode (endereco, latitude, longitude)
    VALUES ($1, $2, $3)
    ON CONFLICT (endereco) DO NOTHING
    RETURNING *;
  `;

  const insertResult = await client.query(insertQuery, [
    geocodeData.endereco,
    geocodeData.latitude,
    geocodeData.longitude,
  ]);

  if (insertResult.rows.length > 0) {
    console.log(`✅ Endereço inserido: ${geocodeData.endereco}`);
    return insertResult.rows[0];
  } else {
    // Já existia com esse endereço formatado
    const { rows: found } = await client.query(
      "SELECT endereco, latitude, longitude FROM public.enderecos_geocode WHERE endereco = $1 LIMIT 1",
      [geocodeData.endereco]
    );

    if (found.length > 0) {
      console.log(`🟡 Endereço já existia: ${geocodeData.endereco}`);
      return found[0];
    } else {
      throw new Error(
        "⚠️ Erro inesperado: endereço não foi salvo nem encontrado."
      );
    }
  }
}

// <<< NOVO ENDPOINT DE OTIMIZAÇÃO >>>
app.post("/optimize-route", async (req, res) => {
  const { origin, stops } = req.body;

  if (!origin || !stops || !Array.isArray(stops) || stops.length === 0) {
    return res.status(400).json({
      error: "É necessário enviar um 'origin' e um array de 'stops'.",
    });
  }

  console.log("\n--- Nova Solicitação de Otimização ---");
  console.log("Origem recebida:", origin);
  console.log("Paradas recebidas:", stops);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Geocodifica todos os pontos (origem + paradas) em paralelo
    const allAddresses = [origin, ...stops];
    const geocodePromises = allAddresses.map((addr) =>
      getGeocode(addr, client)
    );
    const geocodedPoints = await Promise.all(geocodePromises);

    const originPoint = geocodedPoints.shift(); // O primeiro é a origem
    const stopPoints = geocodedPoints; // O resto são as paradas

    console.log("📍 Pontos Geocodificados:", { originPoint, stopPoints });

    // Otimiza a ordem das paradas
    const optimizedStops = otimizarParadas(stopPoints, originPoint);
    console.log(
      "🚗 Rota Otimizada (ordem):",
      optimizedStops.map((p) => p.endereco)
    );

    // Calcula a distância total da rota otimizada
    const totalDistance = calcularDistanciaTotal(optimizedStops, originPoint);
    console.log(`📏 Distância Total Calculada: ${totalDistance.toFixed(2)} km`);

    await client.query("COMMIT");

    res.json({
      origin: {
        name: originPoint.endereco,
        lat: originPoint.latitude,
        lng: originPoint.longitude,
      },
      optimizedRoute: optimizedStops.map((p) => ({
        name: p.endereco,
        lat: p.latitude,
        lng: p.longitude,
      })),
      totalDistance: totalDistance.toFixed(2),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "❗ Erro no processamento do endpoint /optimize-route:",
      err.message
    );
    res.status(500).json({
      error: "Erro interno no servidor ao otimizar a rota.",
      details: err.message,
    });
  } finally {
    client.release();
    console.log("--- Fim da Solicitação ---\n");
  }
});
// 🟢 Endpoint de login
// Arquivo do seu servidor (backend)

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email e senha são obrigatórios." });

  try {
    // 1. ALTERAÇÃO AQUI: Adicione "plano" na consulta SQL
    const result = await pool.query(
      "SELECT id, password, payment_status, plano FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado." });
    }

    if (user.password !== password) {
      return res.status(401).json({ error: "Senha incorreta." });
    }

    // 2. ALTERAÇÃO AQUI: Adicione "plano" na resposta JSON
    return res.json({
      message: "Login realizado com sucesso!",
      user_id: user.id,
      payment_status: user.payment_status,
      plano: user.plano, // <--- LINHA ADICIONADA
    });
  } catch (err) {
    console.error("Erro ao fazer login:", err);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
