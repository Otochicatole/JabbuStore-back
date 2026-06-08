import { prisma } from "../src/shared/infrastructure/PrismaClient";
import { PayPalService } from "../src/shared/infrastructure/PayPalService";

async function testPayPalCapture() {
  console.log("=== INICIANDO SIMULACIÓN DE CAPTURA/WEBHOOK DE PAYPAL ===");

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

  // Guardar originales
  const originalCapture = PayPalService.capturePayment;
  const originalGetAccessToken = PayPalService.getAccessToken;
  const originalGetCredentials = (PayPalService as any).getCredentials;
  
  // Sobrescribir directamente en la clase importada (es single-instance en caché de require)
  (PayPalService as any).getCredentials = function() {
    return {
      clientId: "mock",
      clientSecret: "mock",
      isSandbox: true,
    };
  };

  PayPalService.getAccessToken = async function() {
    return "MOCK_ACCESS_TOKEN_12345";
  };
  
  PayPalService.capturePayment = async function(paypalOrderId: string) {
    console.log(`[Mock PayPalService] Capturando de manera simulada la orden de PayPal: ${paypalOrderId}`);
    return {
      status: "COMPLETED",
      purchase_units: [
        {
          reference_id: order.id,
          payments: {
            captures: [
              {
                id: "MOCK_PAYPAL_CAPTURE_ID_12345",
                status: "COMPLETED",
              }
            ]
          }
        }
      ]
    };
  };

  console.log("Enviando petición POST al webhook local de PayPal para simular retorno exitoso...");
  
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

    if (response.status === 200 && dataResult.success) {
      console.log("¡Webhook procesado con éxito por el servidor! Esperando 1 segundo para que la DB se actualice...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 4. Verificar que el estado de la orden haya transicionado en la base de datos
      console.log("Verificando cambio de estado en la Base de Datos...");
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });

      console.log(`Estado final de la orden: ${updatedOrder?.status}`);
      console.log("Metadata actualizada:", JSON.stringify(updatedOrder?.metadata, null, 2));

      if (updatedOrder?.status === "TRADE_PENDING") {
        console.log("\n🎉 ¡PRUEBA EXITOSA! El estado transicionó de forma segura a TRADE_PENDING y se guardó la metadata del pago de PayPal.");
      } else {
        console.error("\n❌ ERROR: El estado de la orden no cambió.");
      }
    } else {
      console.error("\n❌ ERROR: El webhook devolvió un código de error.");
    }
  } catch (error: any) {
    console.error("\n❌ ERROR de conexión al intentar golpear el servidor:", error.message || error);
  } finally {
    // Restaurar originales
    PayPalService.capturePayment = originalCapture;
    PayPalService.getAccessToken = originalGetAccessToken;
    (PayPalService as any).getCredentials = originalGetCredentials;
    
    // 5. Limpiar la orden de prueba para no ensuciar la base de datos
    await prisma.order.delete({
      where: { id: order.id },
    }).catch(() => {});
    console.log("Orden de prueba eliminada de la base de datos.");
  }
}

testPayPalCapture();
