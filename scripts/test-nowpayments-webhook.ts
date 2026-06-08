import { prisma } from "../src/shared/infrastructure/PrismaClient";
import crypto from "crypto";

async function testNOWPaymentsIPN() {
  console.log("=== INICIANDO SIMULACIÓN DE WEBHOOK NOWPAYMENTS ===");

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
      paymentMethod: "nowpayments",
      metadata: {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        phone: "+123456789",
      },
    },
  });
  console.log(`Orden creada con ID: ${order.id}, Total: $${order.totalPrice} USD`);

  // 3. Construir el payload del IPN (Webhook) tal y como lo envía NOWPayments
  const ipnPayload = {
    payment_id: 123456789,
    payment_status: "finished",
    pay_address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    price_amount: 42.50,
    price_currency: "usd",
    pay_amount: 42.50,
    pay_currency: "usdtbsc",
    order_id: order.id,
    order_description: `Compra en JabbuStore - Orden #${order.id.slice(0, 8)}`,
    invoice_id: 987654321,
  };

  const rawBody = JSON.stringify(ipnPayload);
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET || "TU_NOWPAYMENTS_IPN_SECRET";

  // 4. Generar la firma criptográfica HMAC-SHA512
  const hmac = crypto.createHmac("sha512", ipnSecret);
  hmac.update(rawBody);
  const signature = hmac.digest("hex");

  console.log("Enviando petición POST al webhook local de NOWPayments...");
  
  // 5. Ejecutar la llamada HTTP simulada al servidor
  const port = process.env.PORT || "3001";
  try {
    const response = await fetch(`http://localhost:${port}/api/orders/webhook/nowpayments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nowpayments-sig": signature,
      },
      body: rawBody,
    });

    const responseText = await response.text();
    console.log(`Respuesta del Webhook (Status: ${response.status}):`, responseText);

    if (response.status === 200) {
      console.log("¡Webhook procesado con éxito por el servidor! Esperando 1 segundo para que la DB se actualice...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 6. Verificar que el estado de la orden haya transicionado en la base de datos
      console.log("Verificando cambio de estado en la Base de Datos...");
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });

      console.log(`Estado final de la orden: ${updatedOrder?.status}`);
      console.log("Metadata actualizada:", JSON.stringify(updatedOrder?.metadata, null, 2));

      if (updatedOrder?.status === "TRADE_PENDING") {
        console.log("\n🎉 ¡PRUEBA EXITOSA! El estado transicionó de forma segura a TRADE_PENDING y se guardó la metadata del pago.");
      } else {
        console.error("\n❌ ERROR: El estado de la orden no cambió.");
      }
    } else {
      console.error("\n❌ ERROR: El webhook devolvió un código de error.");
    }
  } catch (error: any) {
    console.error("\n❌ ERROR de conexión al intentar golpear el servidor:", error.message || error);
  } finally {
    // 7. Limpiar la orden de prueba para no ensuciar la base de datos
    await prisma.order.delete({
      where: { id: order.id },
    }).catch(() => {});
    console.log("Orden de prueba eliminada de la base de datos.");
  }
}

testNOWPaymentsIPN();
