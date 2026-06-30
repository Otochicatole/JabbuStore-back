import { prisma } from "../src/shared/infrastructure/PrismaClient";

async function testPayPalCapture() {
  console.log("=== INICIANDO PRUEBA DE HARDENING PAYPAL MOCK ===");

  // 1. Obtener o crear un usuario de prueba
  let user = await prisma.user.findFirst();
  if (!user) {
    console.log("Creando usuario de prueba...");
    user = await prisma.user.create({
      data: {
        id: "test-user-id",
        name: "Test User",
        email: "testuser@jabbustore.com",
        steamId: "76561199000000000",
      },
    });
  }

  // 2. Crear una orden de prueba (BUY) en estado PENDING_PAYMENT
  console.log("Creando orden de prueba...");
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      type: "BUY",
      status: "PENDING_PAYMENT",
      totalPrice: 42.50,
      paymentMethod: "paypal",
      metadata: {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        phone: "+123456789",
      },
    },
  });
  console.log(`Orden creada con ID: ${order.id}, Total: $${order.totalPrice} USD`);

  console.log("Enviando token mock al webhook local de PayPal. La orden NO debe cambiar de estado...");
  
  // 3. Ejecutar la llamada HTTP simulada al servidor
  const port = process.env.PORT || "3001";
  try {
    const response = await fetch(`http://localhost:${port}/api/orders/webhook/paypal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "MOCK_PAYPAL_ORDER_TOKEN_ABCDE"
      }),
    });

    const dataResult = await response.json();
    console.log(`Respuesta del Webhook (Status: ${response.status}):`, JSON.stringify(dataResult, null, 2));

    if (response.status >= 200 && response.status < 500) {
      console.log("Webhook procesado/rechazado de forma controlada. Esperando 1 segundo para verificar DB...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 4. Verificar que el estado de la orden haya transicionado en la base de datos
      console.log("Verificando cambio de estado en la Base de Datos...");
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });

      console.log(`Estado final de la orden: ${updatedOrder?.status}`);
      console.log("Metadata actualizada:", JSON.stringify(updatedOrder?.metadata, null, 2));

      if (updatedOrder?.status === "PENDING_PAYMENT") {
        console.log("\nPRUEBA EXITOSA: el token mock no cambió el estado de la orden.");
      } else {
        console.error("\nERROR: el estado cambió con un token mock.");
      }
    } else {
      console.error("\n❌ ERROR: El webhook devolvió un código de error.");
    }
  } catch (error: any) {
    console.error("\n❌ ERROR de conexión al intentar golpear el servidor:", error.message || error);
  } finally {
    // 5. Limpiar la orden de prueba para no ensuciar la base de datos
    await prisma.order.delete({
      where: { id: order.id },
    }).catch(() => {});
    console.log("Orden de prueba eliminada de la base de datos.");
  }
}

testPayPalCapture();
