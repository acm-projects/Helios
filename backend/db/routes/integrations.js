import express from "express";
import {
  createIntegration,
  updateIntegration,
  getIntegrationById,
  getIntegrationsForUser,
  logValidation
} from "../integrationRepo.js";

const router = express.Router();


// Create integration 
router.post("/", async (req, res) => {
  try {
    const { userId, name, authType, specLocation } = req.body;

    // pointer to where the key will be stored in the vault
    const keyLocation = `vault://user/${userId}/${name}/key`;

    const id = await createIntegration({
      userId,
      name,
      authType,
      specLocation,
      keyLocation,
      status: "pending"
    });

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ADD CREDENTIAL POINTER
router.post("/:id/credentials", async (req, res) => {
  try {
    const { pointer, rawSecret } = req.body;

    if (rawSecret) {
      // Temporarily store raw secrets in a "pendingSecret" field
      await updateIntegration(req.params.id, {
        keyLocation: `placeholder://pending/${req.params.id}`,
        pendingSecret: rawSecret // Temporary field until decision is made
      });
    } else if (pointer) {
      // Store vault pointer directly (future use)
      await updateIntegration(req.params.id, {
        keyLocation: pointer
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// VALIDATE INTEGRATION
router.post("/:id/validate", async (req, res) => {
  try {
    const { status, message, expiresAt } = req.body;

    await updateIntegration(req.params.id, {
      status,
      lastValidatedAt: new Date(),
      expiresAt: expiresAt || null // Optional expiration date
    });

    await logValidation(req.params.id, status, message);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET ALL INTEGRATIONS FOR USER
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    const integrations = await getIntegrationsForUser(String(userId));
    res.json(integrations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET ONE INTEGRATION
router.get("/:id", async (req, res) => {
  try {
    const integration = await getIntegrationById(req.params.id);
    res.json(integration);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET INTEGRATIONS WITH PREFERENCES
router.get("/preferences", async (req, res) => {
  try {
    const preferences = req.query; // Capture preferences from query params
    const integrations = await getIntegrationsWithPreferences(preferences);
    res.json(integrations);
  } catch (err) {
    console.error("Error fetching integrations with preferences:", err);
    res.status(500).send("Internal Server Error");
  }
});


export default router;
