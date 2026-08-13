const express = require("express");
const legalController = require("../controllers/legal.controller");

const router = express.Router();

router.get("/politica-de-privacidade", legalController.privacyPolicy);
router.get("/termos-de-servico", legalController.termsOfService);
router.get("/exclusao-de-dados", legalController.dataDeletion);

module.exports = router;
