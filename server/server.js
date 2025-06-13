require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');
const { sendExpiringProductsEmail } = require('./email');
const { database } = require('./firebase-config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Allow CORS for WebSocket (optional, for local testing)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// In-memory store for products
let products = [];

// Function to check if a product is expiring within 5 days
function isExpiringSoon(expiryDate) {
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  let expDate;
  try {
    expDate = new Date(expiryDate + 'T00:00:00');
    if (isNaN(expDate.getTime())) {
      console.error(`Invalid expiry date: ${expiryDate}`);
      return false;
    }
  } catch (error) {
    console.error(`Error parsing expiry date ${expiryDate}:`, error);
    return false;
  }
  const diffTime = expDate - currentDate;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= 5 && diffDays >= 0;
}

// Function to fetch product details from Open Food Facts API
async function fetchProductDetails(barcode) {
  try {
    const response = await axios.get(`https://world.openfoodfacts.net/api/v2/product/${barcode}.json`);
    console.log(`Open Food Facts response for barcode ${barcode}:`, response.data);
    const product = response.data.product;

    if (!product || response.data.status === 0) {
      throw new Error('Product not found in Open Food Facts');
    }

    const productData = {
      id: Date.now(),
      name: product.product_name || 'Unknown Product',
      expiryDate: '2025-06-30',
      manufacturingDate: product.manufacturing_places || 'Unknown',
      protein: product.nutriments?.proteins || 'Unknown',
      vitamins: product.nutriments?.vitamins || 'None',
      weight: product.quantity || 'Unknown',
      category: product.categories?.split(',')[0] || 'Unknown',
      price: 1.0,
      ingredients: product.ingredients_text || 'Unknown',
      description: product.generic_name || 'No description available'
    };

    return productData;
  } catch (error) {
    console.error('Error fetching product details from Open Food Facts:', error.message);
    throw error;
  }
}

// Function to save product to Firebase
async function saveProductToFirebase(barcode, productData) {
  try {
    await database.ref(`/products/${barcode}`).set(productData);
    console.log(`Product ${productData.name} saved to Firebase under barcode ${barcode}`);
  } catch (error) {
    console.error('Error saving product to Firebase:', error.message);
    throw new Error(`Failed to save product to Firebase: ${error.message}`);
  }
}

// Function to delete product from Firebase
async function deleteProductFromFirebase(barcode) {
  try {
    await database.ref(`/products/${barcode}`).remove();
    console.log(`Product with barcode ${barcode} removed from Firebase`);
  } catch (error) {
    console.error('Error deleting product from Firebase:', error.message);
    throw new Error(`Failed to delete product from Firebase: ${error.message}`);
  }
}

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.send(JSON.stringify({ type: 'initial', products }));
  console.log('Initial products sent to client:', products);

  ws.on('message', async (message) => {
    console.log('Received message:', message.toString());
    try {
      const data = JSON.parse(message.toString().trim());
      let productData;

      if (data.type === 'delete') {
        const productId = data.productId;
        const productIndex = products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
          const barcode = products[productIndex].barcode || '';
          products.splice(productIndex, 1);
          console.log(`Product with ID ${productId} deleted`);

          if (barcode) {
            await deleteProductFromFirebase(barcode);
          }

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'update', products }));
              console.log('Updated products sent to client after delete:', products);
            }
          });

          const expiringProducts = products.filter(product => isExpiringSoon(product.expiryDate));
          if (expiringProducts.length > 0) {
            sendExpiringProductsEmail(expiringProducts);
          }
        }
        return;
      }

      const input = typeof data === 'string' ? data : JSON.stringify(data);
      if ((input.length === 12 || input.length === 13) && !isNaN(input)) {
        console.log('Processing as barcode');
        try {
          const snapshot = await database.ref(`/products/${input}`).once('value');
          productData = snapshot.val();
          console.log(`Firebase lookup for barcode ${input}:`, productData);
        } catch (error) {
          console.error('Firebase lookup failed:', error.message);
          ws.send(JSON.stringify({ type: 'error', message: `Database error: ${error.message}` }));
          return;
        }

        if (!productData) {
          console.log(`Product with barcode ${input} not found in database. Fetching from Open Food Facts...`);
          try {
            productData = await fetchProductDetails(input);
            await saveProductToFirebase(input, productData);
          } catch (error) {
            console.log(`Prompting manual input for barcode ${input}`);
            ws.send(JSON.stringify({
              type: 'manualInput',
              message: `No data found for barcode ${input}. Please enter details manually on the product page.`,
              barcode: input
            }));
            return;
          }
        }
      } else {
        console.log('Processing as QR code or manual submission');
        try {
          productData = data;
          if (!productData.id || !productData.name || !productData.expiryDate) {
            console.error('Invalid data: Missing required fields');
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid data: Missing required fields' }));
            return;
          }
          if (productData.barcode) {
            console.log(`Saving manual input for barcode ${productData.barcode}:`, productData);
            await saveProductToFirebase(productData.barcode, productData);
            delete productData.barcode;
          }
        } catch (parseError) {
          console.error('Error parsing data:', parseError);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid data format' }));
          return;
        }
      }

      processProduct(productData, ws);
    } catch (error) {
      console.error('Error processing message:', error.message);
      ws.send(JSON.stringify({ type: 'error', message: `Server error processing scan: ${error.message}` }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Function to process product (add or remove)
function processProduct(productData, ws) {
  try {
    const existingProductIndex = products.findIndex(p => p.id === productData.id);
    if (existingProductIndex !== -1) {
      products.splice(existingProductIndex, 1);
      console.log(`Product with ID ${productData.id} removed (sold out)`);
    } else {
      products.push(productData);
      console.log(`Product with ID ${productData.id} added to products array`);
    }

    console.log('Broadcasting updated products:', products);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', products }));
        console.log('Message sent to client:', products);
      }
    });

    const expiringProducts = products.filter(product => isExpiringSoon(product.expiryDate));
    console.log('Expiring products:', expiringProducts);
    if (expiringProducts.length > 0) {
      sendExpiringProductsEmail(expiringProducts);
    }
  } catch (error) {
    console.error('Error in processProduct:', error.message);
    ws.send(JSON.stringify({ type: 'error', message: `Error processing product: ${error.message}` }));
  }
}

// Global error handling to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server on localhost port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
