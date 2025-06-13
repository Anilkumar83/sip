const ws = new WebSocket('ws://localhost:3000');

let products = [];
let expiringProducts = [];
let currentBarcode = null;

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received message from server:', data);
  if (data.type === 'initial' || data.type === 'update') {
    products = data.products || [];
    console.log('Updating product list with:', products);
    updateProductList();
    updateExpiringList();
  } else if (data.type === 'manualInput') {
    currentBarcode = data.barcode;
    console.log(`Manual input required for barcode: ${data.barcode}`);
    document.getElementById('product-id').value = Date.now();
    document.getElementById('product-name').value = 'Unknown Product';
    document.getElementById('product-expiry').value = '2025-06-30';
    document.getElementById('product-manufacture').value = '2024-12-31';
    document.getElementById('product-protein').value = 'Unknown';
    document.getElementById('product-vitamins').value = 'None';
    document.getElementById('product-weight').value = 'Unknown';
    document.getElementById('product-category').value = 'Unknown';
    document.getElementById('product-price').value = 1.0;
    document.getElementById('product-ingredients').value = 'Unknown';
    document.getElementById('product-description').value = 'No description available';
    alert(`Please update the form with details for barcode ${data.barcode}.`);
  } else if (data.type === 'error') {
    console.error('Server error:', data.message);
    alert(`Error: ${data.message}`);
  }
};

ws.onopen = () => {
  console.log('Connected to WebSocket server');
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket connection closed');
};

function updateProductList() {
  const productList = document.getElementById('product-list');
  productList.innerHTML = '';
  console.log('Rendering product list:', products);
  products.forEach(product => {
    const div = document.createElement('div');
    div.className = 'product-item fade-in';
    div.innerHTML = `
      <span class="product-name" onclick="showProductDetails(${product.id})">${product.name}</span>
      <span>Exp: ${product.expiryDate}</span>
      <span>Weight: ${product.weight}</span>
      <span>Price: $${product.price}</span>
      <button class="delete-btn" onclick="deleteProduct(${product.id})">Delete</button>
    `;
    productList.appendChild(div);
  });
}

function updateExpiringList() {
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  expiringProducts = products.filter(product => {
    const expDate = new Date(product.expiryDate + 'T00:00:00');
    const diffTime = expDate - currentDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 5 && diffDays >= 0;
  });

  const expiringList = document.getElementById('expiring-list');
  expiringList.innerHTML = '';
  console.log('Rendering expiring list:', expiringProducts);
  expiringProducts.forEach(product => {
    const div = document.createElement('div');
    div.className = 'product-item expiring fade-in';
    div.innerHTML = `
      <span class="product-name" onclick="showProductDetails(${product.id})">${product.name}</span>
      <span class="warning">⚠ Expiring in ${Math.ceil((new Date(product.expiryDate + 'T00:00:00') - currentDate) / (1000 * 60 * 60 * 24))} days</span>
      <button class="delete-btn" onclick="deleteProduct(${product.id})">Delete</button>
    `;
    expiringList.appendChild(div);
  });

  document.getElementById('expiring-count').textContent = expiringProducts.length;
}

function showProductDetails(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  document.getElementById('modal-product-name').textContent = product.name;
  document.getElementById('modal-product-id').textContent = product.id;
  document.getElementById('modal-product-expiry').textContent = product.expiryDate;
  document.getElementById('modal-product-manufacture').textContent = product.manufacturingDate;
  document.getElementById('modal-product-protein').textContent = product.protein;
  document.getElementById('modal-product-vitamins').textContent = product.vitamins;
  document.getElementById('modal-product-weight').textContent = product.weight;
  document.getElementById('modal-product-category').textContent = product.category;
  document.getElementById('modal-product-price').textContent = product.price;
  document.getElementById('modal-product-ingredients').textContent = product.ingredients;
  document.getElementById('modal-product-description').textContent = product.description;

  const modal = document.getElementById('product-modal');
  modal.style.display = 'block';
}

function deleteProduct(productId) {
  if (confirm('Are you sure you want to delete this product?')) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'delete', productId }));
      console.log(`Delete request sent for product ID: ${productId}`);
    } else {
      console.error('WebSocket not connected');
    }
  }
}

// Modal close functionality
document.querySelector('.modal .close').onclick = () => {
  document.getElementById('product-modal').style.display = 'none';
};

window.onclick = (event) => {
  const modal = document.getElementById('product-modal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
};

document.getElementById('product-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const product = {
    id: parseInt(document.getElementById('product-id').value),
    name: document.getElementById('product-name').value,
    expiryDate: document.getElementById('product-expiry').value,
    manufacturingDate: document.getElementById('product-manufacture').value,
    protein: document.getElementById('product-protein').value || '',
    vitamins: document.getElementById('product-vitamins').value || '',
    weight: document.getElementById('product-weight').value,
    category: document.getElementById('product-category').value,
    price: parseFloat(document.getElementById('product-price').value),
    ingredients: document.getElementById('product-ingredients').value || '',
    description: document.getElementById('product-description').value || '',
    barcode: currentBarcode
  };

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(product));
    console.log('Manual product data sent to server:', product);
  } else {
    console.error('WebSocket not connected');
  }

  document.getElementById('product-form').reset();
  currentBarcode = null;
});