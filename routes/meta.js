const express = require('express');
const counties = require('../data/counties');
const router = express.Router();

router.get('/counties', (req, res) => {
  res.json(Object.keys(counties).sort());
});

router.get('/subcounties/:county', (req, res) => {
  const c = counties[req.params.county];
  if (!c) return res.status(404).json({ error: 'County not found' });
  res.json(c);
});

router.get('/all', (req, res) => {
  res.json(counties);
});

module.exports = router;
