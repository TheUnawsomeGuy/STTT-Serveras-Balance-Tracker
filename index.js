/**
 * Serveras Balance Tracker
 * SillyTavern & TauriTavern Extension to track, calculate, and monitor balance & model pricing
 * from https://serveras.click/v1/balance and https://serveras.click/v1/models
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

// Try to import SlashCommand if available
let SlashCommand = null;
let SlashCommandParser = null;
try {
    const scModule = await import('../../../slash-commands/SlashCommand.js');
    const scpModule = await import('../../../slash-commands/SlashCommandParser.js');
    SlashCommand = scModule.SlashCommand;
    SlashCommandParser = scpModule.SlashCommandParser;
} catch (e) {
    console.debug('[Serveras Balance] Slash commands not available or failed to load:', e);
}

const MODULE_NAME = 'serveras_balance_tracker';
const DEFAULT_URL = 'https://serveras.click/v1/balance';
const DEFAULT_MODELS_URL = 'https://serveras.click/v1/models';
const DEFAULT_RATIO = 16000000; // 16M credits = RM 1.00 on RM5 pack
const DEFAULT_THRESHOLD = 5000000; // 5M credits alert threshold
const DEFAULT_USD_TO_MYR = 4.45; // Reference exchange rate for dual display

/**
 * Official asAi Prepaid Packs (720h / 30 days validity)
 * Source: https://serverasai.com/docs/billing
 */
const PREPAID_PACKS = {
    rm5: {
        id: 'rm5',
        name: 'RM5 Pack',
        priceMYR: 5,
        credits: 80_000_000,
        creditsPerMYR: 16_000_000,
        validityHours: 720,
        badge: 'Popular'
    },
    rm8: {
        id: 'rm8',
        name: 'RM8 Pack',
        priceMYR: 8,
        credits: 140_000_000,
        creditsPerMYR: 17_500_000,
        validityHours: 720,
        badge: '17.5M/RM'
    },
    rm10: {
        id: 'rm10',
        name: 'RM10 Pack',
        priceMYR: 10,
        credits: 200_000_000,
        creditsPerMYR: 20_000_000,
        validityHours: 720,
        badge: '20M/RM'
    },
    rm50: {
        id: 'rm50',
        name: 'RM50 Pack',
        priceMYR: 50,
        credits: 1_100_000_000,
        creditsPerMYR: 22_000_000,
        validityHours: 720,
        badge: '22M/RM'
    },
    rm100: {
        id: 'rm100',
        name: 'RM100 Pack',
        priceMYR: 100,
        credits: 2_250_000_000,
        creditsPerMYR: 22_500_000,
        validityHours: 720,
        badge: 'Best Value'
    },
    custom: {
        id: 'custom',
        name: 'Custom Ratio',
        priceMYR: null,
        credits: null,
        creditsPerMYR: null,
        validityHours: null,
        badge: 'Custom'
    }
};

/**
 * Embedded 54-Model Catalog with Multipliers & Context Windows
 * Source: https://serveras.click/v1/models & https://serverasai.com/docs/models
 */
const DEFAULT_MODELS_CATALOG = [
  {
    "id": "asai/qwen3.7-max",
    "name": "qwen3.7-max",
    "provider": "Alibaba",
    "input": 4.43,
    "output": 22.13,
    "cache": 1.11,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 19925,
    "estRepliesRM5": 4015,
    "slideEligible": true
  },
  {
    "id": "asai/qwen3.8-flash",
    "name": "qwen3.8-flash",
    "provider": "Alibaba",
    "input": 3,
    "output": 15,
    "cache": 0.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 13500,
    "estRepliesRM5": 5925,
    "slideEligible": true
  },
  {
    "id": "asai/qwen3.8-max",
    "name": "qwen3.8-max",
    "provider": "Alibaba",
    "input": 6,
    "output": 30,
    "cache": 1.5,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 27000,
    "estRepliesRM5": 2962,
    "slideEligible": true
  },
  {
    "id": "asai/claude-haiku-4.5",
    "name": "claude-haiku-4.5",
    "provider": "Anthropic",
    "input": 3,
    "output": 15,
    "cache": 0.75,
    "context": 200000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 13500,
    "estRepliesRM5": 5925,
    "slideEligible": true
  },
  {
    "id": "asai/claude-haiku-5.5",
    "name": "claude-haiku-5.5",
    "provider": "Anthropic",
    "input": 3,
    "output": 15,
    "cache": 0.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 13500,
    "estRepliesRM5": 5925,
    "slideEligible": true
  },
  {
    "id": "asai/claude-opus-4.6",
    "name": "claude-opus-4.6",
    "provider": "Anthropic",
    "input": 15,
    "output": 75,
    "cache": 3.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 67500,
    "estRepliesRM5": 1185,
    "slideEligible": true
  },
  {
    "id": "asai/claude-opus-4.7",
    "name": "claude-opus-4.7",
    "provider": "Anthropic",
    "input": 15,
    "output": 75,
    "cache": 3.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 67500,
    "estRepliesRM5": 1185,
    "slideEligible": true
  },
  {
    "id": "asai/claude-opus-4.8",
    "name": "claude-opus-4.8",
    "provider": "Anthropic",
    "input": 15,
    "output": 75,
    "cache": 3.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 67500,
    "estRepliesRM5": 1185,
    "slideEligible": true
  },
  {
    "id": "asai/claude-opus-5",
    "name": "claude-opus-5",
    "provider": "Anthropic",
    "input": 15,
    "output": 75,
    "cache": 3.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 67500,
    "estRepliesRM5": 1185,
    "slideEligible": true
  },
  {
    "id": "asai/claude-opus-5.5",
    "name": "claude-opus-5.5",
    "provider": "Anthropic",
    "input": 15,
    "output": 75,
    "cache": 3.75,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 67500,
    "estRepliesRM5": 1185,
    "slideEligible": true
  },
  {
    "id": "asai/claude-sonnet-4.6",
    "name": "claude-sonnet-4.6",
    "provider": "Anthropic",
    "input": 9,
    "output": 45,
    "cache": 2.25,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 40500,
    "estRepliesRM5": 1975,
    "slideEligible": true
  },
  {
    "id": "asai/claude-sonnet-5",
    "name": "claude-sonnet-5",
    "provider": "Anthropic",
    "input": 10.5,
    "output": 52.5,
    "cache": 2.63,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 47250,
    "estRepliesRM5": 1693,
    "slideEligible": true
  },
  {
    "id": "asai/claude-sonnet-5.5",
    "name": "claude-sonnet-5.5",
    "provider": "Anthropic",
    "input": 10.5,
    "output": 52.5,
    "cache": 2.625,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 47250,
    "estRepliesRM5": 1693,
    "slideEligible": true
  },
  {
    "id": "asai/freemodel-2-MiniMax",
    "name": "freemodel-2-MiniMax",
    "provider": "asAi",
    "input": 0,
    "output": 0,
    "cache": 0,
    "context": 1048576,
    "maxOutput": 16384,
    "free": true,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "Free",
    "typicalCost": 1000,
    "estRepliesRM5": 80000,
    "slideEligible": false
  },
  {
    "id": "asai/freemodel-3-deepseekpro",
    "name": "freemodel-3-deepseekpro",
    "provider": "asAi",
    "input": 0,
    "output": 0,
    "cache": 0,
    "context": 1000000,
    "maxOutput": 16384,
    "free": true,
    "modalities": [
      "text"
    ],
    "tier": "Free",
    "typicalCost": 1000,
    "estRepliesRM5": 80000,
    "slideEligible": false
  },
  {
    "id": "asai/freemodel-4-ds-v4.1flash",
    "name": "freemodel-4-ds-v4.1flash",
    "provider": "asAi",
    "input": 0,
    "output": 0,
    "cache": 0,
    "context": 1000000,
    "maxOutput": 16384,
    "free": true,
    "modalities": [
      "text"
    ],
    "tier": "Free",
    "typicalCost": 1000,
    "estRepliesRM5": 80000,
    "slideEligible": false
  },
  {
    "id": "asai/freemodel-5-kimi",
    "name": "freemodel-5-kimi",
    "provider": "asAi",
    "input": 0,
    "output": 0,
    "cache": 0,
    "context": 1048576,
    "maxOutput": 16384,
    "free": true,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "Free",
    "typicalCost": 1000,
    "estRepliesRM5": 80000,
    "slideEligible": false
  },
  {
    "id": "asai/hy4",
    "name": "hy4",
    "provider": "asAi",
    "input": 4.5,
    "output": 22.5,
    "cache": 1.125,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 20250,
    "estRepliesRM5": 3950,
    "slideEligible": false
  },
  {
    "id": "asai/mimo-v2.6-pro",
    "name": "mimo-v2.6-pro",
    "provider": "asAi",
    "input": 3.625,
    "output": 9.0625,
    "cache": 0.375,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 11782,
    "estRepliesRM5": 6790,
    "slideEligible": true
  },
  {
    "id": "asai/mimo-v2.6-pro-mod",
    "name": "mimo-v2.6-pro-mod",
    "provider": "asAi",
    "input": 3.625,
    "output": 9.0625,
    "cache": 0.375,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 11782,
    "estRepliesRM5": 6790,
    "slideEligible": false
  },
  {
    "id": "asai/muse-spark-1.3",
    "name": "muse-spark-1.3",
    "provider": "asAi",
    "input": 5,
    "output": 25,
    "cache": 1.25,
    "context": 1048576,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 22500,
    "estRepliesRM5": 3555,
    "slideEligible": false
  },
  {
    "id": "asai/muse-wonder-1.0",
    "name": "muse-wonder-1.0",
    "provider": "asAi",
    "input": 10,
    "output": 50,
    "cache": 2.5,
    "context": 1048576,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$$",
    "typicalCost": 45000,
    "estRepliesRM5": 1777,
    "slideEligible": true
  },
  {
    "id": "asai/space-bunny",
    "name": "space-bunny",
    "provider": "asAi",
    "input": 0,
    "output": 0,
    "cache": 0,
    "context": 1000000,
    "maxOutput": 16384,
    "free": true,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "Free",
    "typicalCost": 1000,
    "estRepliesRM5": 80000,
    "slideEligible": false
  },
  {
    "id": "asai/deepseek-v4-flash",
    "name": "deepseek-v4-flash",
    "provider": "DeepSeek",
    "input": 2.5,
    "output": 12.5,
    "cache": 0.63,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$",
    "typicalCost": 11250,
    "estRepliesRM5": 7111,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4-flash-0731",
    "name": "deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "input": 2.5,
    "output": 12.5,
    "cache": 0.63,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$",
    "typicalCost": 11250,
    "estRepliesRM5": 7111,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4-pro",
    "name": "deepseek-v4-pro",
    "provider": "DeepSeek",
    "input": 5,
    "output": 25,
    "cache": 1.25,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "$$",
    "typicalCost": 22500,
    "estRepliesRM5": 3555,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4-pro-0813",
    "name": "deepseek-v4-pro-0813",
    "provider": "DeepSeek",
    "input": 5,
    "output": 25,
    "cache": 1.25,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 22500,
    "estRepliesRM5": 3555,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4.1-flash",
    "name": "deepseek-v4.1-flash",
    "provider": "DeepSeek",
    "input": 2.5,
    "output": 12.5,
    "cache": 0.625,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$",
    "typicalCost": 11250,
    "estRepliesRM5": 7111,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4.1-flash-1017",
    "name": "deepseek-v4.1-flash-1017",
    "provider": "DeepSeek",
    "input": 2.5,
    "output": 12.5,
    "cache": 0.625,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "$",
    "typicalCost": 11250,
    "estRepliesRM5": 7111,
    "slideEligible": true
  },
  {
    "id": "asai/deepseek-v4.1-flash-1017-mod",
    "name": "deepseek-v4.1-flash-1017-mod",
    "provider": "DeepSeek",
    "input": 3.8,
    "output": 19,
    "cache": 0.95,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 17100,
    "estRepliesRM5": 4678,
    "slideEligible": false
  },
  {
    "id": "asai/deepseek-v4.1-flash-mod",
    "name": "deepseek-v4.1-flash-mod",
    "provider": "DeepSeek",
    "input": 2.5,
    "output": 12.5,
    "cache": 0.625,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "$",
    "typicalCost": 11250,
    "estRepliesRM5": 7111,
    "slideEligible": false
  },
  {
    "id": "asai/minimax-m3",
    "name": "minimax-m3",
    "provider": "MiniMax",
    "input": 2.1,
    "output": 10.5,
    "cache": 0.53,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$",
    "typicalCost": 9450,
    "estRepliesRM5": 8465,
    "slideEligible": true
  },
  {
    "id": "asai/minimax-m3.1-flash",
    "name": "minimax-m3.1-flash",
    "provider": "MiniMax",
    "input": 1.05,
    "output": 5.25,
    "cache": 0.13125,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$",
    "typicalCost": 4725,
    "estRepliesRM5": 16931,
    "slideEligible": true
  },
  {
    "id": "asai/kimi-k2.7",
    "name": "kimi-k2.7",
    "provider": "Moonshot",
    "input": 3.8,
    "output": 19,
    "cache": 0.95,
    "context": 256000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image"
    ],
    "tier": "$$",
    "typicalCost": 17100,
    "estRepliesRM5": 4678,
    "slideEligible": true
  },
  {
    "id": "asai/kimi-k3",
    "name": "kimi-k3",
    "provider": "Moonshot",
    "input": 9,
    "output": 45,
    "cache": 2.25,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$$",
    "typicalCost": 40500,
    "estRepliesRM5": 1975,
    "slideEligible": true
  },
  {
    "id": "asai/kimi-k3.1-pro",
    "name": "kimi-k3.1-pro",
    "provider": "Moonshot",
    "input": 6,
    "output": 30,
    "cache": 1.5,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 27000,
    "estRepliesRM5": 2962,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-5.6-luna",
    "name": "gpt-5.6-luna",
    "provider": "OpenAI",
    "input": 5.63,
    "output": 28.13,
    "cache": 1.41,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 25325,
    "estRepliesRM5": 3158,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "provider": "OpenAI",
    "input": 10,
    "output": 50,
    "cache": 2.5,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 45000,
    "estRepliesRM5": 1777,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-5.6-terra",
    "name": "gpt-5.6-terra",
    "provider": "OpenAI",
    "input": 7.5,
    "output": 37.5,
    "cache": 1.88,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 33750,
    "estRepliesRM5": 2370,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-6-astra",
    "name": "gpt-6-astra",
    "provider": "OpenAI",
    "input": 30,
    "output": 150,
    "cache": 7.5,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 135000,
    "estRepliesRM5": 592,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-6-luna",
    "name": "gpt-6-luna",
    "provider": "OpenAI",
    "input": 5.625,
    "output": 28.125,
    "cache": 1.40625,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 25313,
    "estRepliesRM5": 3160,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-6-sol",
    "name": "gpt-6-sol",
    "provider": "OpenAI",
    "input": 10,
    "output": 50,
    "cache": 2.5,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 45000,
    "estRepliesRM5": 1777,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-6.1-sol",
    "name": "gpt-6.1-sol",
    "provider": "OpenAI",
    "input": 10,
    "output": 50,
    "cache": 2.5,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 45000,
    "estRepliesRM5": 1777,
    "slideEligible": true
  },
  {
    "id": "asai/gpt-6.1-terra",
    "name": "gpt-6.1-terra",
    "provider": "OpenAI",
    "input": 7.5,
    "output": 37.5,
    "cache": 1.875,
    "context": 1050000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$$",
    "typicalCost": 33750,
    "estRepliesRM5": 2370,
    "slideEligible": true
  },
  {
    "id": "asai/grok-4.7",
    "name": "grok-4.7",
    "provider": "xAI",
    "input": 6,
    "output": 30,
    "cache": 1.5,
    "context": 500000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 27000,
    "estRepliesRM5": 2962,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.0-turbo",
    "name": "glm-5.0-turbo",
    "provider": "Zhipu AI",
    "input": 4.8,
    "output": 24,
    "cache": 1.2,
    "context": 200000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 21600,
    "estRepliesRM5": 3703,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.1",
    "name": "glm-5.1",
    "provider": "Zhipu AI",
    "input": 5.6,
    "output": 28,
    "cache": 1.4,
    "context": 200000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 25200,
    "estRepliesRM5": 3174,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.2",
    "name": "glm-5.2",
    "provider": "Zhipu AI",
    "input": 5.6,
    "output": 28,
    "cache": 1.4,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 25200,
    "estRepliesRM5": 3174,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.3",
    "name": "glm-5.3",
    "provider": "Zhipu AI",
    "input": 5.6,
    "output": 28,
    "cache": 1.4,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 25200,
    "estRepliesRM5": 3174,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.3-flash",
    "name": "glm-5.3-flash",
    "provider": "Zhipu AI",
    "input": 2.8,
    "output": 14,
    "cache": 0.7,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 12600,
    "estRepliesRM5": 6349,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.3-flash-mod",
    "name": "glm-5.3-flash-mod",
    "provider": "Zhipu AI",
    "input": 2.8,
    "output": 14,
    "cache": 0.7,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 12600,
    "estRepliesRM5": 6349,
    "slideEligible": false
  },
  {
    "id": "asai/glm-5.3-flashx",
    "name": "glm-5.3-flashx",
    "provider": "Zhipu AI",
    "input": 5.6,
    "output": 28,
    "cache": 1.4,
    "context": 1000000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video"
    ],
    "tier": "$$",
    "typicalCost": 25200,
    "estRepliesRM5": 3174,
    "slideEligible": true
  },
  {
    "id": "asai/glm-5.3-mod",
    "name": "glm-5.3-mod",
    "provider": "Zhipu AI",
    "input": 3.8,
    "output": 19,
    "cache": 0.95,
    "context": 200000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text"
    ],
    "tier": "$$",
    "typicalCost": 17100,
    "estRepliesRM5": 4678,
    "slideEligible": false
  },
  {
    "id": "asai/glm-5v-turbo",
    "name": "glm-5v-turbo",
    "provider": "Zhipu AI",
    "input": 4.8,
    "output": 24,
    "cache": 1.2,
    "context": 200000,
    "maxOutput": 16384,
    "free": false,
    "modalities": [
      "text",
      "image",
      "video",
      "file"
    ],
    "tier": "$$",
    "typicalCost": 21600,
    "estRepliesRM5": 3703,
    "slideEligible": true
  }
];

// Runtime state
let intervalTimer = null;
let isFetching = false;
let sessionSpent = 0;
let lastBalanceBeforeGen = null;
let preGenTimestamp = 0;
let lastFetchError = null;
let currentCatalogFilter = 'all';
let currentCatalogSearch = '';

/**
 * Check if running under TauriTavern environment
 */
function isTauriHost() {
    return Boolean(
        window.__TAURITAVERN__ ||
        window.__TAURITAVERN_HOST__ ||
        window.__TAURI__ ||
        window.__TAURITAVERN_MAIN_READY__
    );
}

/**
 * Default extension settings
 */
const defaultSettings = {
    enabled: true,
    apiKey: '',
    apiUrl: DEFAULT_URL,
    modelsUrl: DEFAULT_MODELS_URL,
    useCorsProxy: true,
    customProxyUrl: '', // Optional proxy prefix, e.g. "http://localhost:8008/proxy/"
    autoRefreshOnGen: true,
    autoRefreshInterval: 10, // minutes (0 = disabled)
    displayFormat: 'credits_compact', // 'credits_compact', 'credits_full', 'currency', 'both'
    selectedPack: 'rm5', // 'rm5', 'rm8', 'rm10', 'rm50', 'rm100', 'custom'
    currencyUnit: 'RM', // 'RM', 'USD', 'BOTH'
    usdToMyrRate: DEFAULT_USD_TO_MYR,
    creditsPerDollar: 1000000, // Legacy fallback
    lowBalanceNotify: true,
    lowBalanceThreshold: DEFAULT_THRESHOLD,
    showInStatusBar: true,
    showFloatingBadge: true,
    lastKnownBalance: null,
    lastCost: null,
    lastUpdated: null,
    history: [],
    customModelsCatalog: null // Synced catalog if fetched from /v1/models
};

/**
 * Access settings with defaults
 */
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_NAME][k] === undefined) {
            extension_settings[MODULE_NAME][k] = v;
        }
    }
    return extension_settings[MODULE_NAME];
}

/**
 * Persist settings safely
 */
function saveSettings() {
    try {
        saveSettingsDebounced();
    } catch (e) {
        console.debug('[Serveras Balance] saveSettingsDebounced error:', e);
    }
}

/**
 * Get active models catalog (cached custom or built-in default)
 */
function getModelsCatalog() {
    const s = getSettings();
    if (Array.isArray(s.customModelsCatalog) && s.customModelsCatalog.length > 0) {
        return s.customModelsCatalog;
    }
    return DEFAULT_MODELS_CATALOG;
}

/**
 * Deduce AI provider from model ID
 */
function getProviderFromName(id) {
    const clean = id.replace(/^asai\//, '').toLowerCase();
    if (clean.startsWith('claude')) return 'Anthropic';
    if (clean.startsWith('gpt') || clean.startsWith('o1') || clean.startsWith('o3') || clean.startsWith('o4')) return 'OpenAI';
    if (clean.startsWith('gemini')) return 'Google';
    if (clean.startsWith('deepseek')) return 'DeepSeek';
    if (clean.startsWith('grok')) return 'xAI';
    if (clean.startsWith('mistral') || clean.startsWith('codestral') || clean.startsWith('pixtral')) return 'Mistral';
    if (clean.startsWith('llama')) return 'Meta';
    if (clean.startsWith('qwen')) return 'Alibaba';
    if (clean.startsWith('kimi') || clean.startsWith('moonshot')) return 'Moonshot';
    if (clean.startsWith('glm')) return 'Zhipu AI';
    if (clean.startsWith('minimax')) return 'MiniMax';
    if (clean.startsWith('cohere') || clean.startsWith('command')) return 'Cohere';
    return 'asAi';
}

/**
 * Calculate effective credits per MYR based on selected pack
 */
function getCreditsPerMYR(s) {
    const pack = PREPAID_PACKS[s.selectedPack] || PREPAID_PACKS.rm5;
    if (pack.creditsPerMYR) {
        return pack.creditsPerMYR;
    }
    const fx = Number(s.usdToMyrRate) > 0 ? Number(s.usdToMyrRate) : DEFAULT_USD_TO_MYR;
    const usdRatio = Number(s.creditsPerDollar) > 0 ? Number(s.creditsPerDollar) : 1000000;
    return Math.round(usdRatio / fx);
}

/**
 * Number & Currency Formatting Helpers
 */
function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return Number(num).toLocaleString('en-US');
}

function formatCompact(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    const abs = Math.abs(num);
    if (abs >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    }
    if (abs >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (abs >= 1_000) {
        return (num / 1_000).toFixed(1) + 'k';
    }
    return String(num);
}

function formatCurrency(credits, settings = null) {
    if (credits === null || credits === undefined || isNaN(credits)) return '—';
    const s = settings || getSettings();
    const c = Number(credits);
    const creditsPerMYR = getCreditsPerMYR(s);
    const fx = Number(s.usdToMyrRate) > 0 ? Number(s.usdToMyrRate) : DEFAULT_USD_TO_MYR;

    const myr = c / creditsPerMYR;
    const usd = myr / fx;
    const mode = s.currencyUnit || 'RM';

    const fmtMYR = 'RM ' + myr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    const fmtUSD = '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

    if (mode === 'USD') return fmtUSD;
    if (mode === 'BOTH') return `${fmtMYR} (${fmtUSD})`;
    return fmtMYR;
}

function formatDisplay(credits, format = 'credits_compact', settings = null) {
    if (credits === null || credits === undefined || isNaN(credits)) return '—';
    const s = settings || getSettings();
    switch (format) {
        case 'credits_full':
            return formatNumber(credits) + ' credits';
        case 'currency':
            return formatCurrency(credits, s);
        case 'both':
            return `${formatCompact(credits)} (${formatCurrency(credits, s)})`;
        case 'credits_compact':
        default:
            return formatCompact(credits);
    }
}

function formatRelativeTime(ts) {
    if (!ts) return 'Never';
    const elapsed = Math.floor((Date.now() - ts) / 1000);
    if (elapsed < 5) return 'Just now';
    if (elapsed < 60) return `${elapsed}s ago`;
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return new Date(ts).toLocaleTimeString();
}

/**
 * Official Serveras Billing Formula
 * credits = Math.max(1000, Math.ceil((input - cache_read) * m_in + cache_read * m_cache + output * m_out))
 */
function calculateModelCost(model, inputTokens, outputTokens, cacheTokens = 0) {
    if (!model) return 1000;
    if (model.free) return 1000; // Free models: minimum charge 1,000 credits
    const m_in = Number(model.input) || 0;
    const m_out = Number(model.output) || 0;
    const m_cache = Number(model.cache) || 0;
    const nonCacheIn = Math.max(0, inputTokens - cacheTokens);
    const computed = Math.ceil(nonCacheIn * m_in + cacheTokens * m_cache + outputTokens * m_out);
    return Math.max(1000, computed);
}

/**
 * Detect active model from SillyTavern UI / settings
 */
function detectActiveModel() {
    try {
        const oaiVal = $('#model_openai_select').val()?.trim();
        if (oaiVal) return oaiVal;

        const customVal = $('#model_custom_select').val()?.trim();
        if (customVal) return customVal;

        if (window.oai_settings?.openai_model) {
            return String(window.oai_settings.openai_model).trim();
        }

        const activeProfile = extension_settings?.connectionManager?.activeProfile;
        if (activeProfile?.model) return activeProfile.model.trim();

        for (const sel of ['#model_claude_select', '#model_openrouter_select', '#model_deepseek_select']) {
            const val = $(sel).val()?.trim();
            if (val) return val;
        }
    } catch (e) {
        console.debug('[Serveras Balance] detectActiveModel error:', e);
    }
    return null;
}

/**
 * Lookup model in catalog
 */
function findModelInCatalog(query) {
    if (!query) return null;
    const catalog = getModelsCatalog();
    const cleanQuery = String(query).trim().toLowerCase();
    const strippedQuery = cleanQuery.replace(/^asai\//, '');

    // 1. Exact match on id
    let found = catalog.find(m => m.id.toLowerCase() === cleanQuery || m.id.toLowerCase() === `asai/${strippedQuery}`);
    if (found) return found;

    // 2. Exact match on clean name
    found = catalog.find(m => m.name.toLowerCase() === strippedQuery);
    if (found) return found;

    // 3. Partial match
    found = catalog.find(m => m.name.toLowerCase().includes(strippedQuery) || strippedQuery.includes(m.name.toLowerCase()));
    if (found) return found;

    return null;
}

/**
 * Auto-detect API key from SillyTavern or TauriTavern secret store / DOM / settings
 */
async function detectSillyTavernApiKey() {
    try {
        const scKey = extension_settings?.summaryception?.openaiKey?.trim();
        if (scKey && scKey.startsWith('asai_')) return scKey;

        const connProfiles = extension_settings?.connectionManager?.profiles;
        if (Array.isArray(connProfiles)) {
            for (const p of connProfiles) {
                if (p.custom_url?.includes('serveras.click') && p.api_key) {
                    return p.api_key.trim();
                }
            }
        }

        const domKey = $('#api_key_openai').val()?.trim() || $('#api_key_chatcompletions').val()?.trim();
        if (domKey && domKey.startsWith('asai_')) return domKey;

        if (window.oai_settings && window.oai_settings.api_key_openai) {
            const k = String(window.oai_settings.api_key_openai).trim();
            if (k && k.startsWith('asai_')) return k;
        }

        const proxyPass = $('#proxy_password').val()?.trim();
        if (proxyPass && proxyPass.startsWith('asai_')) return proxyPass;

        const candidateKeys = ['api_key_openai', 'api_key_custom', 'proxy_password'];
        for (const key of candidateKeys) {
            try {
                if (window.__TAURITAVERN__?.invoke?.safeInvoke) {
                    const res = await window.__TAURITAVERN__.invoke.safeInvoke('find_secret', { dto: { key } });
                    const val = typeof res === 'object' ? res?.value?.trim() : String(res || '').trim();
                    if (val && val.startsWith('asai_')) return val;
                    if (val && !domKey) return val;
                }

                const resp = await fetch('/api/secrets/find', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const val = data?.value?.trim();
                    if (val && val.startsWith('asai_')) return val;
                    if (val && !domKey) return val;
                }
            } catch {
                // Continue to next secret candidate
            }
        }

        try {
            const resp = await fetch('/api/secrets/view', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (resp.ok) {
                const secrets = await resp.json();
                if (secrets && typeof secrets === 'object') {
                    for (const val of Object.values(secrets)) {
                        if (typeof val === 'string' && val.trim().startsWith('asai_')) {
                            return val.trim();
                        }
                    }
                    if (secrets.api_key_openai?.trim()) return secrets.api_key_openai.trim();
                    if (secrets.api_key_custom?.trim()) return secrets.api_key_custom.trim();
                }
            }
        } catch {
            // Ignore view error
        }

        if (scKey) return scKey;
        if (domKey && !domKey.includes('•')) return domKey;
    } catch (e) {
        console.debug('[Serveras Balance] Key auto-detect failed:', e);
    }
    return '';
}

/**
 * Get effective API key (configured or auto-detected)
 */
async function getEffectiveApiKey() {
    const s = getSettings();
    if (s.apiKey && s.apiKey.trim()) {
        return s.apiKey.trim();
    }
    const detected = await detectSillyTavernApiKey();
    if (detected) {
        s.apiKey = detected;
        saveSettings();
        return detected;
    }
    return '';
}

/**
 * Build list of candidate request URLs based on settings and environment
 */
function buildFetchCandidates(targetUrl, settings) {
    const candidates = [];
    const isTauri = isTauriHost();

    // 1. User-configured Custom Proxy (Highest precedence if specified)
    if (settings.customProxyUrl && settings.customProxyUrl.trim()) {
        const customPrefix = settings.customProxyUrl.trim().replace(/\/+$/, '');
        candidates.push({
            url: `${customPrefix}/${targetUrl}`,
            desc: `Custom Proxy (${customPrefix})`,
            isProxy: true
        });
    }

    if (isTauri) {
        candidates.push({
            url: targetUrl,
            desc: 'Direct Endpoint',
            isProxy: false
        });
        if (settings.useCorsProxy) {
            candidates.push({
                url: `/proxy/${targetUrl}`,
                desc: 'SillyTavern Server Proxy (/proxy/)',
                isProxy: true,
                isRelativeProxy: true
            });
        }
    } else {
        if (settings.useCorsProxy) {
            candidates.push({
                url: `/proxy/${targetUrl}`,
                desc: 'SillyTavern Server Proxy (/proxy/)',
                isProxy: true,
                isRelativeProxy: true
            });
        }
        candidates.push({
            url: targetUrl,
            desc: 'Direct Endpoint',
            isProxy: false
        });
    }

    if (isTauri) {
        candidates.push({
            url: `http://localhost:8000/proxy/${targetUrl}`,
            desc: 'Local SillyTavern (port 8000)',
            isProxy: true
        });
        candidates.push({
            url: `http://localhost:8008/proxy/${targetUrl}`,
            desc: 'Local SillyTavern (port 8008)',
            isProxy: true
        });
        candidates.push({
            url: `http://10.0.2.2:8008/proxy/${targetUrl}`,
            desc: 'Android Host Loopback (port 8008)',
            isProxy: true
        });
        candidates.push({
            url: `http://10.0.2.2:8000/proxy/${targetUrl}`,
            desc: 'Android Host Loopback (port 8000)',
            isProxy: true
        });
    }

    return candidates;
}

/**
 * Fetch balance from endpoint with smart retry across candidate URLs
 */
async function fetchBalance({ silent = false, isPostGen = false } = {}) {
    if (isFetching) return null;
    const settings = getSettings();

    if (!settings.enabled) return null;

    const apiKey = await getEffectiveApiKey();
    if (!apiKey) {
        if (!silent) {
            toastr?.warning?.('Please configure or auto-detect your Serveras API key.', 'Serveras Balance');
        }
        updateUI();
        return null;
    }

    isFetching = true;
    updateSpinners(true);

    try {
        const targetUrl = (settings.apiUrl || DEFAULT_URL).trim();
        const candidates = buildFetchCandidates(targetUrl, settings);
        let lastErrorText = '';
        let successfulResp = null;
        let usedCandidate = null;

        for (const candidate of candidates) {
            try {
                console.debug(`[Serveras Balance] Attempting fetch via: ${candidate.desc} (${candidate.url})`);
                const resp = await fetch(candidate.url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'application/json'
                    }
                });

                if (!resp.ok && resp.status === 404 && candidate.isRelativeProxy) {
                    const text = await resp.text();
                    if (text.includes('Unsupported endpoint') || text.includes('Cannot GET /proxy')) {
                        console.debug('[Serveras Balance] Host does not support relative /proxy/, skipping to next candidate.');
                        continue;
                    }
                }

                if (resp.status === 401) {
                    const errBody = await resp.text();
                    let detail = 'Invalid API Key';
                    try {
                        const j = JSON.parse(errBody);
                        detail = j.detail || j.message || detail;
                    } catch { /* ignore */ }
                    if (!silent) toastr?.error?.(`Authentication Failed: ${detail}`, 'Serveras Balance');
                    throw new Error(`Authentication Failed (HTTP 401): ${detail}`);
                }

                if (resp.ok) {
                    successfulResp = resp;
                    usedCandidate = candidate;
                    break;
                } else {
                    lastErrorText = `HTTP ${resp.status}: ${resp.statusText || 'Error'}`;
                }
            } catch (fetchErr) {
                if (fetchErr.message && fetchErr.message.includes('Authentication Failed')) {
                    throw fetchErr;
                }
                const errStr = String(fetchErr?.message || fetchErr);
                lastErrorText = errStr;
                console.debug(`[Serveras Balance] Candidate ${candidate.desc} failed:`, fetchErr);
            }
        }

        if (!successfulResp) {
            const isTauri = isTauriHost();
            let diagnosticMsg = lastErrorText || 'Could not connect to balance endpoint.';
            if (isTauri && (!settings.customProxyUrl || !settings.customProxyUrl.trim())) {
                diagnosticMsg = 'TauriTavern CORS Restriction: Direct access to serveras.click is blocked by browser CORS policy. Set a Custom Proxy URL (e.g. http://localhost:8008/proxy/) in Serveras Balance settings.';
            }

            lastFetchError = diagnosticMsg;
            if (!silent) {
                toastr?.error?.(diagnosticMsg, 'Serveras Balance');
            }
            throw new Error(diagnosticMsg);
        }

        lastFetchError = null;
        const data = await successfulResp.json();
        const availableCredits = data.available_credits ?? data.credits ?? data.balance;

        if (availableCredits === undefined || availableCredits === null) {
            throw new Error('Response JSON missing available_credits field');
        }

        const newBalance = Number(availableCredits);
        const prevBalance = settings.lastKnownBalance !== null ? Number(settings.lastKnownBalance) : null;
        let delta = null;

        if (prevBalance !== null) {
            delta = newBalance - prevBalance;
        }

        let cost = 0;
        if (delta !== null && delta < 0) {
            cost = Math.abs(delta);
            sessionSpent += cost;
            settings.lastCost = cost;
        }

        settings.lastKnownBalance = newBalance;
        settings.lastUpdated = Date.now();

        if (!Array.isArray(settings.history)) {
            settings.history = [];
        }

        settings.history.unshift({
            timestamp: Date.now(),
            balance: newBalance,
            delta: delta,
            cost: cost,
            isGen: isPostGen,
            source: usedCandidate?.desc || 'online'
        });

        if (settings.history.length > 20) {
            settings.history = settings.history.slice(0, 20);
        }

        saveSettings();
        updateUI();

        if (settings.lowBalanceNotify && newBalance <= (Number(settings.lowBalanceThreshold) || DEFAULT_THRESHOLD)) {
            toastr?.warning?.(
                `Warning: Available balance is low (${formatCompact(newBalance)} credits)!`,
                'Serveras Balance'
            );
        }

        if (!silent) {
            toastr?.success?.(
                `Balance: ${formatCompact(newBalance)} credits (${formatCurrency(newBalance, settings)})`,
                'Serveras Balance'
            );
        }

        return { newBalance, delta, cost };
    } catch (err) {
        console.error('[Serveras Balance] Error fetching balance:', err);
        updateUI();
        return null;
    } finally {
        isFetching = false;
        updateSpinners(false);
    }
}

/**
 * Fetch live model rates from /v1/models and update catalog
 */
async function syncLiveModelsCatalog({ silent = false } = {}) {
    const s = getSettings();
    const apiKey = await getEffectiveApiKey();
    const targetUrl = (s.modelsUrl || DEFAULT_MODELS_URL).trim();
    const candidates = buildFetchCandidates(targetUrl, s);

    if (!silent) toastr?.info?.('Syncing live models and pricing from Serveras...', 'Serveras Balance');

    for (const candidate of candidates) {
        try {
            const headers = { 'Accept': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

            const resp = await fetch(candidate.url, { method: 'GET', headers });
            if (resp.ok) {
                const json = await resp.json();
                if (Array.isArray(json.data) && json.data.length > 0) {
                    const parsed = json.data.map(m => {
                        const inp = parseFloat(m.rates?.input || 0);
                        const out = parseFloat(m.rates?.output || 0);
                        const cache = parseFloat(m.rates?.cache || 0);
                        const isFree = m.billing_mode === 'free' || (inp === 0 && out === 0);
                        const cleanName = m.id.replace(/^asai\//, '');
                        const provider = getProviderFromName(m.id);
                        const tier = isFree ? 'Free' : (inp <= 2.5 ? '$' : (inp <= 6.0 ? '$$' : '$$$'));
                        const typicalCost = isFree ? 1000 : Math.max(1000, Math.ceil(2000 * inp + 500 * out));
                        return {
                            id: m.id,
                            name: cleanName,
                            provider: provider,
                            input: inp,
                            output: out,
                            cache: cache,
                            context: m.context_length || 0,
                            maxOutput: m.max_output || 0,
                            free: isFree,
                            modalities: m.input_modalities || ['text'],
                            tier: tier,
                            typicalCost: typicalCost,
                            slideEligible: !!m.slide_eligible
                        };
                    });
                    parsed.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
                    s.customModelsCatalog = parsed;
                    saveSettings();
                    renderCatalogTable(currentCatalogFilter, currentCatalogSearch);
                    updateUI();
                    if (!silent) toastr?.success?.(`Successfully synced ${parsed.length} models and pricing!`, 'Serveras Balance');
                    return parsed;
                }
            }
        } catch (e) {
            console.debug(`[Serveras Balance] Sync via ${candidate.desc} failed:`, e);
        }
    }

    if (!silent) toastr?.warning?.('Could not reach /v1/models. Using default 54-model catalog.', 'Serveras Balance');
    return null;
}

/**
 * Toggle spinning state on refresh buttons
 */
function updateSpinners(spinning) {
    $('.serveras-refresh-icon').toggleClass('serveras-spinning', spinning);
}

/**
 * Update all UI widgets
 */
function updateUI() {
    const s = getSettings();
    const balance = s.lastKnownBalance;
    const cost = s.lastCost;
    const isLow = balance !== null && balance <= (Number(s.lowBalanceThreshold) || DEFAULT_THRESHOLD);

    const formattedCompact = formatCompact(balance);
    const formattedFull = formatNumber(balance);
    const formattedCurrencyVal = formatCurrency(balance, s);
    const formattedDisplayVal = formatDisplay(balance, s.displayFormat, s);

    // 1. Update Drawer Settings Hero Card
    $('#serveras_drawer_balance_large').text(formattedFull !== '—' ? formattedFull : '—');
    $('#serveras_drawer_currency_est').text(formattedCurrencyVal !== '—' ? formattedCurrencyVal : '');
    $('#serveras_drawer_last_updated').text(`Updated: ${formatRelativeTime(s.lastUpdated)}`);

    if (cost && cost > 0) {
        $('#serveras_drawer_last_cost').html(`
            <span class="serveras-cost-pill">
                <i class="fa-solid fa-arrow-down"></i> ${formatCompact(cost)} credits (${formatCurrency(cost, s)})
            </span>
        `);
    } else {
        $('#serveras_drawer_last_cost').html('<span class="serveras-cost-pill is-zero">—</span>');
    }

    if (sessionSpent > 0) {
        $('#serveras_drawer_session_spent').html(`
            <span class="serveras-session-pill">
                ${formatCompact(sessionSpent)} credits (${formatCurrency(sessionSpent, s)})
            </span>
        `);
    } else {
        $('#serveras_drawer_session_spent').html('<span class="serveras-session-pill">0 credits</span>');
    }

    // Active Model Card update
    const activeModelId = detectActiveModel();
    const model = findModelInCatalog(activeModelId);

    if (model) {
        $('#serveras_active_model_name').text(model.name);
        const $tier = $('#serveras_active_model_tier');
        $tier.text(model.free ? 'FREE MODEL' : `${model.tier} TIER`);
        $tier.toggleClass('is-tier-free', model.free);

        const mIn = model.free ? 0 : model.input;
        const mOut = model.free ? 0 : model.output;
        const mCache = model.free ? 0 : model.cache;

        $('#serveras_active_model_rates').html(`
            <span title="Input Prompt Multiplier"><b>In:</b> ${mIn}×</span>
            <span title="Completion Output Multiplier"><b>Out:</b> ${mOut}×</span>
            <span title="Cache Read Multiplier"><b>Cache:</b> ${mCache}×</span>
        `);

        const typicalCost = calculateModelCost(model, 2000, 500, 0);
        if (balance !== null && balance > 0) {
            const estTurns = Math.floor(balance / typicalCost);
            const estTurnsFmt = formatNumber(estTurns);
            const freeNote = model.free ? ' (1k min charge)' : '';
            $('#serveras_active_model_est').html(`
                <i class="fa-solid fa-calculator"></i> Est: <b>~${estTurnsFmt} replies</b> remaining${freeNote} <span style="opacity: 0.7;">(~${formatCompact(typicalCost)} cr/turn)</span>
            `);
        } else {
            $('#serveras_active_model_est').html(`
                <i class="fa-solid fa-calculator"></i> Typical turn cost: <b>~${formatCompact(typicalCost)} credits</b> (2k in / 500 out)
            `);
        }
    } else if (activeModelId) {
        $('#serveras_active_model_name').text(activeModelId.replace(/^asai\//, ''));
        $('#serveras_active_model_tier').text('CUSTOM').removeClass('is-tier-free');
        $('#serveras_active_model_rates').html('<span>In: ?×</span><span>Out: ?×</span><span>Cache: ?×</span>');
        $('#serveras_active_model_est').text('Model not in Serveras catalog (using standard formula)');
    } else {
        $('#serveras_active_model_name').text('None detected');
        $('#serveras_active_model_tier').text('—').removeClass('is-tier-free');
        $('#serveras_active_model_rates').html('<span>In: —</span><span>Out: —</span><span>Cache: —</span>');
        $('#serveras_active_model_est').text('Select an OpenAI/Custom model in SillyTavern to see rates');
    }

    // Diagnostic alert box
    const $diagBox = $('#serveras_drawer_diagnostic');
    if ($diagBox.length) {
        if (lastFetchError) {
            $diagBox.html(`
                <div class="serveras-warning-box">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <div style="flex: 1;">
                        <b>Connection Notice:</b><br/>
                        <span>${lastFetchError}</span>
                    </div>
                </div>
            `).show();
        } else {
            $diagBox.empty().hide();
        }
    }

    // Render history table
    renderHistoryTable(s.history);

    // 2. Update OpenCode IDE Status Bar Widget
    const statusBarItem = document.getElementById('serveras-sb-item');
    if (statusBarItem) {
        const valSpan = statusBarItem.querySelector('.serveras-sb-val');
        const costSpan = statusBarItem.querySelector('.serveras-sb-cost');
        if (valSpan) {
            valSpan.textContent = formattedDisplayVal;
            valSpan.classList.toggle('serveras-low-balance', isLow);
        }
        if (costSpan) {
            if (cost && cost > 0) {
                costSpan.textContent = `-${formatCompact(cost)}`;
                costSpan.style.display = 'inline-block';
            } else {
                costSpan.style.display = 'none';
            }
        }
        statusBarItem.title = `Serveras Balance: ${formattedFull} credits (${formattedCurrencyVal})\nLast Prompt Cost: ${cost ? formatCompact(cost) : '0'} credits\nSession Spent: ${formatCompact(sessionSpent)} credits\n(Click to refresh)`;
        statusBarItem.style.display = s.showInStatusBar ? 'inline-flex' : 'none';
    }

    // 3. Update Floating Badge Widget
    const floatingBadge = document.getElementById('serveras-floating-badge');
    if (floatingBadge) {
        const badgeVal = floatingBadge.querySelector('.serveras-badge-val');
        const badgeCost = floatingBadge.querySelector('.serveras-badge-cost');
        if (badgeVal) {
            badgeVal.textContent = formattedDisplayVal;
            badgeVal.classList.toggle('serveras-low-balance', isLow);
        }
        if (badgeCost) {
            if (cost && cost > 0) {
                badgeCost.textContent = `-${formatCompact(cost)}`;
                badgeCost.style.display = 'inline-block';
            } else {
                badgeCost.style.display = 'none';
            }
        }
        floatingBadge.title = `Serveras Balance: ${formattedFull} credits (${formattedCurrencyVal})\n(Click to refresh)`;
        floatingBadge.style.display = s.showFloatingBadge ? 'flex' : 'none';
    }
}

/**
 * Render History Table
 */
function renderHistoryTable(history) {
    const $tbody = $('#serveras_history_tbody');
    if (!$tbody.length) return;

    if (!Array.isArray(history) || history.length === 0) {
        $tbody.html('<tr><td colspan="4" class="serveras-history-empty">No balance checks recorded yet.</td></tr>');
        return;
    }

    const rows = history.map((item) => {
        const timeStr = new Date(item.timestamp).toLocaleTimeString();
        let deltaHtml = '<span style="opacity: 0.5;">—</span>';
        if (item.delta !== null && item.delta !== undefined) {
            if (item.delta < 0) {
                deltaHtml = `<span class="serveras-history-delta-neg">-${formatCompact(Math.abs(item.delta))}</span>`;
            } else if (item.delta > 0) {
                deltaHtml = `<span class="serveras-history-delta-pos">+${formatCompact(item.delta)}</span>`;
            } else {
                deltaHtml = '<span style="opacity: 0.5;">0</span>';
            }
        }

        const tag = item.isGen ? '<span title="Post-generation check" style="opacity:0.8;">[Gen]</span>' : '<span title="Manual/Scheduled check" style="opacity:0.6;">[Poll]</span>';

        return `
            <tr>
                <td style="opacity: 0.75;">${timeStr}</td>
                <td>${deltaHtml}</td>
                <td style="font-weight: 500;">${formatCompact(item.balance)}</td>
                <td>${tag}</td>
            </tr>
        `;
    }).join('');

    $tbody.html(rows);
}

/**
 * Render Model Rates Catalog Table
 */
function renderCatalogTable(filter = 'all', searchQuery = '') {
    const $tbody = $('#serveras_catalog_tbody');
    if (!$tbody.length) return;

    const catalog = getModelsCatalog();
    const q = (searchQuery || '').trim().toLowerCase();

    const filtered = catalog.filter(m => {
        if (q) {
            const matchesId = m.id.toLowerCase().includes(q);
            const matchesName = m.name.toLowerCase().includes(q);
            const matchesProvider = m.provider.toLowerCase().includes(q);
            if (!matchesId && !matchesName && !matchesProvider) return false;
        }

        switch (filter) {
            case 'free':
                return m.free;
            case 'anthropic':
                return m.provider === 'Anthropic';
            case 'openai':
                return m.provider === 'OpenAI';
            case 'deepseek':
                return m.provider === 'DeepSeek';
            case 'vision':
                return m.modalities && m.modalities.includes('image');
            case '1m':
                return m.context >= 1_000_000;
            case 'budget':
                return m.tier === '$' || m.tier === 'Free';
            case 'all':
            default:
                return true;
        }
    });

    if (filtered.length === 0) {
        $tbody.html('<tr><td colspan="6" style="text-align: center; opacity: 0.6; padding: 12px;">No matching models found.</td></tr>');
        return;
    }

    const rows = filtered.map(m => {
        const tierClass = m.free ? 'tier-free' : (m.tier === '$$$' ? 'tier-3' : (m.tier === '$$' ? 'tier-2' : 'tier-1'));
        const tierLabel = m.free ? 'Free' : m.tier;
        const ctxStr = m.context >= 1_000_000 ? `${(m.context / 1_000_000).toFixed(0)}M` : `${Math.round(m.context / 1000)}k`;
        const multipliers = m.free ? '0× / 0× / 0×' : `${m.input}× / ${m.output}× / ${m.cache}×`;
        const typicalCost = formatCompact(m.typicalCost) + ' cr';

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-weight: 500; font-family: var(--ide-font-mono, monospace); font-size: 10.5px;">${m.name}</span>
                        <button type="button" class="serveras-copy-btn" data-model="${m.id}" title="Copy model ID: ${m.id}">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td style="opacity: 0.85;">${m.provider}</td>
                <td style="font-family: var(--ide-font-mono, monospace); font-size: 10px;">${multipliers}</td>
                <td style="opacity: 0.8;">${ctxStr}</td>
                <td><span class="serveras-tier-tag ${tierClass}">${tierLabel}</span></td>
                <td style="font-weight: 500; color: #a6e3a1;">~${typicalCost}</td>
            </tr>
        `;
    }).join('');

    $tbody.html(rows);

    $tbody.find('.serveras-copy-btn').off('click').on('click', function(e) {
        e.stopPropagation();
        const modelId = $(this).attr('data-model');
        if (modelId) {
            if (navigator?.clipboard?.writeText) {
                navigator.clipboard.writeText(modelId);
            }
            toastr?.info?.(`Copied <b>${modelId}</b> to clipboard!`, 'Serveras Balance');
        }
    });
}

/**
 * Inject the Settings Drawer UI into #extensions_settings2
 */
function injectDrawerUI() {
    if (document.getElementById('serveras-balance-settings-container')) return;

    const s = getSettings();
    const isTauri = isTauriHost();
    const envBadge = isTauri
        ? '<span class="serveras-env-tag is-tauri" title="Running in TauriTavern Native Runtime"><i class="fa-solid fa-mobile-screen"></i> TauriTavern</span>'
        : '<span class="serveras-env-tag is-st" title="Running in SillyTavern Web"><i class="fa-solid fa-globe"></i> SillyTavern</span>';

    const drawerHtml = `
    <div id="serveras-balance-settings-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Serveras Balance & Pricing</b>
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${envBadge}
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
            </div>
            <div class="inline-drawer-content">
                <div class="serveras-drawer-panel">
                    
                    <!-- Hero Card -->
                    <div class="serveras-hero-card">
                        <div class="serveras-hero-header">
                            <span class="serveras-hero-title">
                                <i class="fa-solid fa-coins" style="color: #f9e2af;"></i> Available Balance
                            </span>
                            <div class="serveras-hero-actions">
                                <button type="button" class="serveras-refresh-btn" id="serveras_btn_refresh">
                                    <i class="fa-solid fa-rotate serveras-refresh-icon"></i> Refresh
                                </button>
                            </div>
                        </div>

                        <div class="serveras-hero-main">
                            <div class="serveras-balance-large">
                                <span id="serveras_drawer_balance_large">—</span>
                                <span class="serveras-currency-est" id="serveras_drawer_currency_est"></span>
                            </div>
                            <span class="serveras-subtext" id="serveras_drawer_last_updated">Never updated</span>
                        </div>

                        <div class="serveras-stats-row">
                            <div class="serveras-stat-item">
                                <span class="serveras-stat-label">Last Generation Cost</span>
                                <div id="serveras_drawer_last_cost">
                                    <span class="serveras-cost-pill is-zero">—</span>
                                </div>
                            </div>
                            <div class="serveras-stat-item">
                                <span class="serveras-stat-label">Session Total Spent</span>
                                <div id="serveras_drawer_session_spent">
                                    <span class="serveras-session-pill">0 credits</span>
                                </div>
                            </div>
                        </div>

                        <!-- Active Model & Rate Breakdown -->
                        <div class="serveras-active-model-card" id="serveras_active_model_card">
                            <div class="serveras-active-model-header">
                                <span class="serveras-active-model-title">
                                    <i class="fa-solid fa-microchip"></i> Active Model: <b id="serveras_active_model_name">Detecting...</b>
                                </span>
                                <span class="serveras-rate-pill" id="serveras_active_model_tier">—</span>
                            </div>
                            <div class="serveras-active-model-multipliers" id="serveras_active_model_rates">
                                <span>In: —</span>
                                <span>Out: —</span>
                                <span>Cache: —</span>
                            </div>
                            <div class="serveras-active-model-est" id="serveras_active_model_est">
                                Est: ~— replies remaining
                            </div>
                        </div>
                    </div>

                    <!-- Connection / Diagnostic Alert Box -->
                    <div id="serveras_drawer_diagnostic" style="display: none;"></div>

                    <!-- Model Pricing & Rate Catalog Section -->
                    <div class="serveras-section-title" style="margin-top: 14px;">
                        <span><i class="fa-solid fa-tags"></i> Model Pricing & Rate Catalog</span>
                        <button type="button" class="serveras-btn-small" id="serveras_btn_sync_catalog" title="Sync latest models & multipliers from serveras.click">
                            <i class="fa-solid fa-cloud-arrow-down"></i> Sync Rates
                        </button>
                    </div>

                    <div class="serveras-catalog-container">
                        <div class="serveras-catalog-search-row">
                            <input type="text" id="serveras_catalog_search" class="text_pole" placeholder="Search 54+ models (e.g. sonnet, deepseek, free)..." />
                        </div>
                        <div class="serveras-catalog-filters" id="serveras_catalog_filters">
                            <button type="button" class="serveras-filter-btn is-active" data-filter="all">All</button>
                            <button type="button" class="serveras-filter-btn" data-filter="free">Free (4)</button>
                            <button type="button" class="serveras-filter-btn" data-filter="anthropic">Anthropic</button>
                            <button type="button" class="serveras-filter-btn" data-filter="openai">OpenAI</button>
                            <button type="button" class="serveras-filter-btn" data-filter="deepseek">DeepSeek</button>
                            <button type="button" class="serveras-filter-btn" data-filter="vision">Vision</button>
                            <button type="button" class="serveras-filter-btn" data-filter="1m">1M Context</button>
                        </div>
                        <div class="serveras-catalog-scroll">
                            <table class="serveras-catalog-table">
                                <thead>
                                    <tr>
                                        <th>Model</th>
                                        <th>Provider</th>
                                        <th>In / Out / Cache</th>
                                        <th>Context</th>
                                        <th>Tier</th>
                                        <th>Est. Turn</th>
                                    </tr>
                                </thead>
                                <tbody id="serveras_catalog_tbody">
                                    <!-- Rendered dynamically -->
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Configuration Section -->
                    <div class="serveras-section-title" style="margin-top: 16px;">
                        <i class="fa-solid fa-sliders"></i> Configuration
                    </div>

                    <!-- API Key -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_api_key">
                            <span>API Key:</span>
                            <span class="serveras-subtext">(Stored securely in extension settings)</span>
                        </label>
                        <div class="serveras-input-with-button">
                            <div class="serveras-key-wrapper">
                                <input type="password" id="serveras_input_api_key" class="text_pole" placeholder="asai_sk_..." autocomplete="off" value="${s.apiKey || ''}" />
                                <i class="fa-solid fa-eye serveras-eye-toggle" id="serveras_toggle_key_eye" title="Show/Hide API Key"></i>
                            </div>
                            <button type="button" class="serveras-btn-small" id="serveras_btn_autodetect" title="Auto-detect API key from active settings or secret manager">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Fill
                            </button>
                        </div>
                    </div>

                    <!-- Active Prepaid Pack -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_select_pack">
                            <span>Active Prepaid Pack:</span>
                            <span class="serveras-subtext">(Calculates credits-to-Ringgit value)</span>
                        </label>
                        <select id="serveras_select_pack" class="text_pole">
                            <option value="rm5" ${s.selectedPack === 'rm5' ? 'selected' : ''}>RM5 Pack — 80M credits (16M / RM, 720h)</option>
                            <option value="rm8" ${s.selectedPack === 'rm8' ? 'selected' : ''}>RM8 Pack — 140M credits (17.5M / RM, 720h)</option>
                            <option value="rm10" ${s.selectedPack === 'rm10' ? 'selected' : ''}>RM10 Pack — 200M credits (20M / RM, 720h)</option>
                            <option value="rm50" ${s.selectedPack === 'rm50' ? 'selected' : ''}>RM50 Pack — 1.1B credits (22M / RM, 720h)</option>
                            <option value="rm100" ${s.selectedPack === 'rm100' ? 'selected' : ''}>RM100 Pack (Best Value) — 2.25B credits (22.5M / RM, 720h)</option>
                            <option value="custom" ${s.selectedPack === 'custom' ? 'selected' : ''}>Custom Ratio</option>
                        </select>
                    </div>

                    <!-- Currency Display & Exchange Rate -->
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <div class="serveras-field-group" style="flex: 1; min-width: 140px;">
                            <label class="serveras-field-label" for="serveras_select_currency">Currency Display:</label>
                            <select id="serveras_select_currency" class="text_pole">
                                <option value="RM" ${s.currencyUnit === 'RM' ? 'selected' : ''}>RM (Malaysian Ringgit)</option>
                                <option value="USD" ${s.currencyUnit === 'USD' ? 'selected' : ''}>USD ($)</option>
                                <option value="BOTH" ${s.currencyUnit === 'BOTH' ? 'selected' : ''}>Both (RM & USD)</option>
                            </select>
                        </div>
                        <div class="serveras-field-group" style="flex: 1; min-width: 140px;">
                            <label class="serveras-field-label" for="serveras_input_fx_rate">USD/MYR Rate:</label>
                            <input type="number" id="serveras_input_fx_rate" class="text_pole" step="0.01" min="1" value="${s.usdToMyrRate || DEFAULT_USD_TO_MYR}" />
                        </div>
                    </div>

                    <!-- Custom Proxy URL (Essential for TauriTavern & Mobile) -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_custom_proxy">
                            <span>Custom CORS Proxy URL (Optional):</span>
                            <span class="serveras-subtext">${isTauri ? '(Recommended for TauriTavern / Mobile)' : '(Optional)'}</span>
                        </label>
                        <div class="serveras-input-with-button">
                            <input type="text" id="serveras_input_custom_proxy" class="text_pole" value="${s.customProxyUrl || ''}" placeholder="e.g. http://localhost:8008/proxy/ or http://192.168.1.235:8008/proxy/" />
                            <button type="button" class="serveras-btn-small" id="serveras_btn_detect_proxy" title="Auto-detect local SillyTavern server proxy">
                                <i class="fa-solid fa-network-wired"></i> Auto-Detect
                            </button>
                        </div>
                        <small style="opacity: 0.65; font-size: 11px; margin-top: 2px;">
                            ${isTauri
                                ? 'In TauriTavern, direct fetches are blocked by CORS. If using USB/Scrcpy, run <code>adb reverse tcp:8008 tcp:8008</code> on your PC. Over Wi-Fi, enter your PC\'s LAN IP (e.g. <code>http://192.168.1.136:8008/proxy/</code>).'
                                : 'You can route through your SillyTavern server (e.g. <code>http://localhost:8008/proxy/</code>) or leave blank if using a dev server.'}
                        </small>
                    </div>

                    <!-- Display Format -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_select_format">Display Format:</label>
                        <select id="serveras_select_format" class="text_pole">
                            <option value="credits_compact" ${s.displayFormat === 'credits_compact' ? 'selected' : ''}>Compact Credits (e.g. 188.17M)</option>
                            <option value="credits_full" ${s.displayFormat === 'credits_full' ? 'selected' : ''}>Full Number (e.g. 188,174,424 credits)</option>
                            <option value="currency" ${s.displayFormat === 'currency' ? 'selected' : ''}>Currency (e.g. RM 11.76 / $2.64)</option>
                            <option value="both" ${s.displayFormat === 'both' ? 'selected' : ''}>Both (188.17M (RM 11.76))</option>
                        </select>
                    </div>

                    <!-- Low Balance Threshold -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_threshold">Low Balance Alert Threshold:</label>
                        <input type="number" id="serveras_input_threshold" class="text_pole" min="0" value="${s.lowBalanceThreshold || DEFAULT_THRESHOLD}" />
                    </div>

                    <!-- Auto-refresh interval -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_select_interval">Periodic Background Refresh:</label>
                        <select id="serveras_select_interval" class="text_pole">
                            <option value="0" ${s.autoRefreshInterval === 0 ? 'selected' : ''}>Disabled</option>
                            <option value="1" ${s.autoRefreshInterval === 1 ? 'selected' : ''}>Every 1 minute</option>
                            <option value="5" ${s.autoRefreshInterval === 5 ? 'selected' : ''}>Every 5 minutes</option>
                            <option value="10" ${s.autoRefreshInterval === 10 ? 'selected' : ''}>Every 10 minutes</option>
                            <option value="30" ${s.autoRefreshInterval === 30 ? 'selected' : ''}>Every 30 minutes</option>
                        </select>
                    </div>

                    <!-- Checkboxes -->
                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_autogen" ${s.autoRefreshOnGen ? 'checked' : ''} />
                        <span>Auto-refresh & track prompt cost after every message generation</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_proxy" ${s.useCorsProxy ? 'checked' : ''} />
                        <span>Use host server proxy (Prevents browser CORS errors on SillyTavern)</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_low_notify" ${s.lowBalanceNotify ? 'checked' : ''} />
                        <span>Notify with warning toast when balance falls below threshold</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_status_bar" ${s.showInStatusBar ? 'checked' : ''} />
                        <span>Show in OpenCode IDE Status Bar</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_floating_badge" ${s.showFloatingBadge ? 'checked' : ''} />
                        <span>Show Floating Balance Badge (Draggable)</span>
                    </label>

                    <!-- Reset Floating Badge Position Button -->
                    <div style="margin-top: 6px; margin-bottom: 14px;">
                        <button type="button" class="serveras-btn-small" id="serveras_btn_reset_pos" style="font-size: 11px;">
                            <i class="fa-solid fa-arrows-to-dot"></i> Reset Floating Badge Position
                        </button>
                    </div>

                    <!-- Activity History -->
                    <div class="serveras-section-title">
                        <span>
                            <i class="fa-solid fa-clock-rotate-left"></i> Recent Activity Log
                        </span>
                        <button type="button" class="serveras-btn-small" id="serveras_btn_clear_history" style="font-size: 10.5px; padding: 2px 6px;">
                            <i class="fa-solid fa-trash-can"></i> Clear
                        </button>
                    </div>

                    <div class="serveras-history-wrapper">
                        <table class="serveras-history-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Cost / Delta</th>
                                    <th>Balance</th>
                                    <th>Type</th>
                                </tr>
                            </thead>
                            <tbody id="serveras_history_tbody">
                                <tr><td colspan="4" class="serveras-history-empty">No balance checks recorded yet.</td></tr>
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    </div>
    `;

    $('#extensions_settings2').append(drawerHtml);

    // Initial catalog render
    renderCatalogTable(currentCatalogFilter, currentCatalogSearch);

    // Wire events
    $('#serveras_btn_refresh').on('click', () => fetchBalance({ silent: false }));
    $('#serveras_btn_sync_catalog').on('click', () => syncLiveModelsCatalog({ silent: false }));

    // Catalog search input
    $('#serveras_catalog_search').on('input', function() {
        currentCatalogSearch = $(this).val();
        renderCatalogTable(currentCatalogFilter, currentCatalogSearch);
    });

    // Catalog filter buttons
    $('#serveras_catalog_filters .serveras-filter-btn').on('click', function() {
        $('#serveras_catalog_filters .serveras-filter-btn').removeClass('is-active');
        $(this).addClass('is-active');
        currentCatalogFilter = $(this).attr('data-filter') || 'all';
        renderCatalogTable(currentCatalogFilter, currentCatalogSearch);
    });

    $('#serveras_input_api_key').on('input', function() {
        s.apiKey = $(this).val().trim();
        saveSettings();
        updateUI();
    });

    $('#serveras_toggle_key_eye').on('click', function() {
        const input = document.getElementById('serveras_input_api_key');
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        $(this).toggleClass('fa-eye', !isPassword).toggleClass('fa-eye-slash', isPassword);
    });

    $('#serveras_btn_autodetect').on('click', async function() {
        const detected = await detectSillyTavernApiKey();
        if (detected) {
            $('#serveras_input_api_key').val(detected);
            s.apiKey = detected;
            saveSettings();
            toastr?.success?.('API Key auto-detected and filled!', 'Serveras Balance');
            fetchBalance({ silent: false });
        } else {
            toastr?.info?.('Could not auto-detect API key. Please paste it manually.', 'Serveras Balance');
        }
    });

    $('#serveras_select_pack').on('change', function() {
        s.selectedPack = $(this).val();
        saveSettings();
        updateUI();
    });

    $('#serveras_select_currency').on('change', function() {
        s.currencyUnit = $(this).val();
        saveSettings();
        updateUI();
    });

    $('#serveras_input_fx_rate').on('input', function() {
        const val = Number($(this).val());
        if (val > 0) {
            s.usdToMyrRate = val;
            saveSettings();
            updateUI();
        }
    });

    $('#serveras_input_custom_proxy').on('input', function() {
        s.customProxyUrl = $(this).val().trim();
        saveSettings();
    });

    $('#serveras_btn_detect_proxy').on('click', async function() {
        const candidates = [];

        if (typeof window !== 'undefined' && window.location?.origin && /^https?:\/\//i.test(window.location.origin)) {
            candidates.push(`${window.location.origin.replace(/\/+$/, '')}/proxy/`);
        }

        candidates.push(
            'http://localhost:8000/proxy/',
            'http://127.0.0.1:8000/proxy/',
            'http://localhost:8008/proxy/',
            'http://127.0.0.1:8008/proxy/',
            'http://10.0.2.2:8008/proxy/',
            'http://10.0.2.2:8000/proxy/'
        );

        toastr?.info?.('Probing local SillyTavern proxy...', 'Serveras Balance');
        let found = null;
        for (const c of candidates) {
            try {
                const testUrl = c.replace(/\/proxy\/$/, '/version');
                const resp = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(1500) });
                if (resp.ok) {
                    found = c;
                    break;
                }
            } catch { /* continue */ }
        }

        if (found) {
            s.customProxyUrl = found;
            $('#serveras_input_custom_proxy').val(found);
            saveSettings();
            toastr?.success?.(`Found active SillyTavern proxy: ${found}`, 'Serveras Balance');
            fetchBalance({ silent: false });
        } else {
            const advice = isTauriHost()
                ? 'Could not find local server on device. On Android via USB/Scrcpy, run "adb reverse tcp:8008 tcp:8008" on your PC, or enter your PC\'s Wi-Fi IP.'
                : 'Could not auto-detect a local SillyTavern server. You can enter the URL manually if SillyTavern is running on another IP.';
            toastr?.warning?.(advice, 'Serveras Balance');
        }
    });

    $('#serveras_select_format').on('change', function() {
        s.displayFormat = $(this).val();
        saveSettings();
        updateUI();
    });

    $('#serveras_input_threshold').on('input', function() {
        const val = Number($(this).val());
        if (val >= 0) {
            s.lowBalanceThreshold = val;
            saveSettings();
            updateUI();
        }
    });

    $('#serveras_select_interval').on('change', function() {
        s.autoRefreshInterval = Number($(this).val());
        saveSettings();
        restartIntervalTimer();
    });

    $('#serveras_chk_autogen').on('change', function() {
        s.autoRefreshOnGen = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_proxy').on('change', function() {
        s.useCorsProxy = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_low_notify').on('change', function() {
        s.lowBalanceNotify = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_status_bar').on('change', function() {
        s.showInStatusBar = $(this).is(':checked');
        saveSettings();
        updateUI();
    });

    $('#serveras_chk_floating_badge').on('change', function() {
        s.showFloatingBadge = $(this).is(':checked');
        saveSettings();
        updateUI();
    });

    $('#serveras_btn_reset_pos').on('click', function() {
        delete s.badgePos;
        saveSettings();
        const badge = document.getElementById('serveras-floating-badge');
        if (badge) {
            badge.style.left = '';
            badge.style.top = '';
            badge.style.right = '';
            badge.style.bottom = '';
        }
        toastr?.info?.('Badge position reset to default.', 'Serveras Balance');
    });

    $('#serveras_btn_clear_history').on('click', function() {
        s.history = [];
        saveSettings();
        renderHistoryTable([]);
        toastr?.info?.('Balance history cleared.', 'Serveras Balance');
    });

    updateUI();
}

/**
 * Inject OpenCode IDE Status Bar Widget
 */
function injectStatusBarWidget() {
    if (document.getElementById('serveras-sb-item')) return;

    const statusBar = document.getElementById('opencode-status-bar');
    if (!statusBar) return;

    document.body.classList.add('opencode-has-status-bar');

    const statusItem = document.createElement('span');
    statusItem.id = 'serveras-sb-item';
    statusItem.className = 'status-item serveras-status-item';
    statusItem.innerHTML = `
        <i class="fa-solid fa-coins"></i>
        <span class="serveras-sb-val">—</span>
        <span class="serveras-sb-cost" style="display:none;"></span>
    `;

    statusItem.addEventListener('click', (e) => {
        e.stopPropagation();
        fetchBalance({ silent: false });
    });

    const statusRight = statusBar.querySelector('.status-right');
    if (statusRight) {
        statusRight.insertBefore(statusItem, statusRight.firstChild);
    } else {
        statusBar.appendChild(statusItem);
    }

    updateUI();
}

/**
 * Enable drag & drop positioning with touch and mouse support
 */
function makeBadgeDraggable(badge) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;

    const s = getSettings();
    if (s.badgePos && typeof s.badgePos === 'object') {
        const { left, top } = s.badgePos;
        if (left !== undefined && top !== undefined) {
            badge.style.left = left;
            badge.style.top = top;
            badge.style.right = 'auto';
            badge.style.bottom = 'auto';
        }
    }

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        isDragging = true;
        hasMoved = false;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;

        const rect = badge.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        badge.style.transition = 'none';
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
        badge.style.left = `${initialLeft}px`;
        badge.style.top = `${initialTop}px`;
        badge.classList.add('serveras-dragging');

        if (e.type === 'touchstart') {
            window.addEventListener('touchmove', onPointerMove, { passive: false });
            window.addEventListener('touchend', onPointerUp, { once: true });
            window.addEventListener('touchcancel', onPointerUp, { once: true });
        } else {
            window.addEventListener('mousemove', onPointerMove);
            window.addEventListener('mouseup', onPointerUp, { once: true });
        }
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            hasMoved = true;
            if (e.cancelable) e.preventDefault();
        }

        const maxLeft = Math.max(0, window.innerWidth - badge.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - badge.offsetHeight);
        const newLeft = Math.max(0, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(0, Math.min(maxTop, initialTop + dy));

        badge.style.left = `${newLeft}px`;
        badge.style.top = `${newTop}px`;
    }

    function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        badge.style.transition = '';
        badge.classList.remove('serveras-dragging');

        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('touchmove', onPointerMove);

        if (hasMoved) {
            const currentSettings = getSettings();
            currentSettings.badgePos = {
                left: badge.style.left,
                top: badge.style.top,
            };
            saveSettings();
        } else {
            fetchBalance({ silent: false });
        }
    }

    badge.addEventListener('mousedown', onPointerDown);
    badge.addEventListener('touchstart', onPointerDown, { passive: true });
}

/**
 * Inject Floating Widget with Layout ABI mobile surface support
 */
function injectFloatingWidget() {
    if (document.getElementById('serveras-floating-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'serveras-floating-badge';
    badge.setAttribute('data-tt-mobile-surface', 'free-window');
    badge.title = 'Serveras Balance (Drag to move, click to refresh)';
    badge.innerHTML = `
        <i class="fa-solid fa-coins"></i>
        <span class="serveras-badge-val">—</span>
        <span class="serveras-badge-cost" style="display:none;"></span>
    `;

    makeBadgeDraggable(badge);

    document.body.appendChild(badge);
    updateUI();
}

/**
 * Setup timer for periodic refresh
 */
function restartIntervalTimer() {
    if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
    }

    const s = getSettings();
    const minutes = Number(s.autoRefreshInterval);
    if (minutes > 0) {
        intervalTimer = setInterval(() => {
            fetchBalance({ silent: true });
        }, minutes * 60 * 1000);
    }
}

/**
 * Register Slash Commands
 */
function registerSlashCommands() {
    if (!SlashCommandParser || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'balance',
        callback: async (namedArgs, unnamedArgs) => {
            const raw = String(unnamedArgs || '').trim();
            const parts = raw.split(/\s+/);
            const sub = (parts[0] || '').toLowerCase();
            const s = getSettings();

            if (sub === 'refresh') {
                const res = await fetchBalance({ silent: false });
                if (res) {
                    return `Serveras Balance: ${formatCompact(res.newBalance)} credits (${formatCurrency(res.newBalance, s)})`;
                }
                return 'Failed to refresh balance.';
            }

            if (sub === 'models') {
                const filterQuery = parts.slice(1).join(' ').toLowerCase();
                const catalog = getModelsCatalog();
                const matches = filterQuery
                    ? catalog.filter(m => m.name.toLowerCase().includes(filterQuery) || m.provider.toLowerCase().includes(filterQuery))
                    : catalog;
                if (matches.length === 0) return `No models found matching "${filterQuery}".`;
                const lines = matches.slice(0, 15).map(m => {
                    const mult = m.free ? 'FREE (0×)' : `${m.input}× in / ${m.output}× out / ${m.cache}× cache`;
                    return `• **${m.name}** (${m.provider}) [${m.tier}]: ${mult} (~${formatCompact(m.typicalCost)} cr/turn)`;
                });
                const more = matches.length > 15 ? `\n...and ${matches.length - 15} more (use /balance models <search> to filter).` : '';
                return `**Serveras Models Catalog (${matches.length} models):**\n${lines.join('\n')}${more}`;
            }

            if (sub === 'model') {
                const modelName = parts.slice(1).join(' ').trim();
                if (!modelName) return 'Usage: `/balance model <name>` (e.g. `/balance model sonnet-4.6`)';
                const m = findModelInCatalog(modelName);
                if (!m) return `Model "${modelName}" not found in Serveras catalog. Try \`/balance models ${modelName}\`.`;
                const typCost = calculateModelCost(m, 2000, 500, 0);
                const estReplies = s.lastKnownBalance ? Math.floor(s.lastKnownBalance / typCost) : null;
                return `**${m.name}** (${m.id})\n` +
                       `• Provider: ${m.provider}\n` +
                       `• Tier: ${m.tier} (${m.free ? 'Free model - 1k min charge' : 'Paid'})\n` +
                       `• Rates: In: ${m.input}× | Out: ${m.output}× | Cache Read: ${m.cache}×\n` +
                       `• Context: ${m.context.toLocaleString()} tokens (Max Output: ${m.maxOutput.toLocaleString()})\n` +
                       `• Typical Turn Cost: ~${formatCompact(typCost)} credits (2k in / 500 out)\n` +
                       (estReplies !== null ? `• Est. Replies Remaining: ~${formatNumber(estReplies)} turns on current balance` : '');
            }

            if (sub === 'pack') {
                const packArg = (parts[1] || '').toLowerCase();
                if (PREPAID_PACKS[packArg]) {
                    s.selectedPack = packArg;
                    saveSettings();
                    $('#serveras_select_pack').val(packArg);
                    updateUI();
                    const p = PREPAID_PACKS[packArg];
                    return `Switched active prepaid pack to **${p.name}** (${p.priceMYR ? 'RM ' + p.priceMYR : 'Custom'} = ${p.credits ? formatCompact(p.credits) + ' credits' : 'Custom'}).`;
                }
                const available = Object.keys(PREPAID_PACKS).join(', ');
                return `Usage: \`/balance pack <tier>\`. Available packs: ${available}`;
            }

            if (sub === 'cost') {
                const inTokens = parseInt(parts[1], 10) || 2000;
                const outTokens = parseInt(parts[2], 10) || 500;
                const modelArg = parts.slice(3).join(' ').trim() || detectActiveModel() || 'claude-haiku-4.5';
                const m = findModelInCatalog(modelArg);
                if (!m) return `Model "${modelArg}" not recognized. Specify a model like \`/balance cost 3000 800 sonnet-4.6\`.`;
                const cost = calculateModelCost(m, inTokens, outTokens, 0);
                const costCurr = formatCurrency(cost, s);
                return `**Cost Calculation (${m.name}):**\n` +
                       `• Input: ${inTokens.toLocaleString()} tokens × ${m.input} = ${Math.ceil(inTokens * m.input).toLocaleString()} cr\n` +
                       `• Output: ${outTokens.toLocaleString()} tokens × ${m.output} = ${Math.ceil(outTokens * m.output).toLocaleString()} cr\n` +
                       `• Total Credits: **${cost.toLocaleString()} credits** (${costCurr})\n` +
                       `• (Rule: Hard minimum 1,000 credits applied if calculated < 1,000)`;
            }

            if (sub.startsWith('key ')) {
                const newKey = raw.slice(4).trim();
                s.apiKey = newKey;
                saveSettings();
                $('#serveras_input_api_key').val(newKey);
                toastr?.success?.('API Key updated.', 'Serveras Balance');
                fetchBalance({ silent: false });
                return 'Serveras API Key updated.';
            }

            if (sub.startsWith('proxy ')) {
                const newProxy = raw.slice(6).trim();
                s.customProxyUrl = newProxy;
                saveSettings();
                $('#serveras_input_custom_proxy').val(newProxy);
                toastr?.success?.('Custom Proxy URL updated.', 'Serveras Balance');
                fetchBalance({ silent: false });
                return `Custom Proxy URL updated to: ${newProxy}`;
            }

            const activeModel = detectActiveModel();
            const modelObj = findModelInCatalog(activeModel);
            let activeStr = '';
            if (modelObj) {
                const turnCost = calculateModelCost(modelObj, 2000, 500, 0);
                const replies = s.lastKnownBalance ? Math.floor(s.lastKnownBalance / turnCost) : null;
                activeStr = `\nActive Model: ${modelObj.name} (${modelObj.provider}) [${modelObj.input}× in / ${modelObj.output}× out]` +
                            (replies !== null ? ` • ~${formatNumber(replies)} replies left` : '');
            }

            if (s.lastKnownBalance !== null) {
                const pack = PREPAID_PACKS[s.selectedPack] || PREPAID_PACKS.rm5;
                const msg = `**Serveras Balance:** ${formatCompact(s.lastKnownBalance)} credits (${formatCurrency(s.lastKnownBalance, s)})\n` +
                            `Pack: ${pack.name} | Last Cost: ${s.lastCost ? formatCompact(s.lastCost) + ' cr' : '—'} | Session: ${formatCompact(sessionSpent)} cr` +
                            activeStr;
                toastr?.info?.(msg.replace(/\n/g, '<br>'), 'Serveras Balance');
                return msg;
            } else {
                fetchBalance({ silent: false });
                return 'Fetching Serveras balance...';
            }
        },
        aliases: ['serveras'],
        helpString: 'Serveras Balance & Pricing. Subcommands: refresh, models [search], model <name>, cost <in> <out> [model], pack <tier>, proxy <url>, key <key>'
    }));
}

/**
 * Initialization lifecycle
 */
jQuery(async () => {
    console.log('[Serveras Balance Tracker] Initializing extension...');

    if (window.__TAURITAVERN__?.ready || window.__TAURITAVERN_MAIN_READY__) {
        try {
            await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
            console.log('[Serveras Balance Tracker] TauriTavern host ready.');
        } catch (e) {
            console.debug('[Serveras Balance Tracker] Host ready wait caught:', e);
        }
    }

    const settings = getSettings();

    if (!settings.apiKey) {
        const detected = await detectSillyTavernApiKey();
        if (detected) {
            settings.apiKey = detected;
            saveSettings();
            console.log('[Serveras Balance Tracker] Auto-detected API key on startup.');
        }
    }

    if (isTauriHost() && !settings.customProxyUrl) {
        for (const port of [8000, 8008]) {
            try {
                const resp = await fetch(`http://localhost:${port}/version`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(1200)
                });
                if (resp.ok) {
                    settings.customProxyUrl = `http://localhost:${port}/proxy/`;
                    saveSettings();
                    console.log(`[Serveras Balance Tracker] Auto-configured local SillyTavern proxy on port ${port} for TauriTavern.`);
                    break;
                }
            } catch {
                // SillyTavern not running on this port, continue
            }
        }
    }

    // Inject UI
    injectDrawerUI();
    injectFloatingWidget();
    injectStatusBarWidget();

    // Listen for model changes in SillyTavern to update Hero Card active model immediately
    $(document).on('change', '#model_openai_select, #model_custom_select, #model_claude_select, #model_openrouter_select', () => {
        updateUI();
    });

    const observer = new MutationObserver(() => {
        if (document.getElementById('opencode-status-bar') && !document.getElementById('serveras-sb-item')) {
            injectStatusBarWidget();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Register Slash Commands
    registerSlashCommands();

    // Setup periodic polling timer
    restartIntervalTimer();

    // Setup generation listeners for cost calculation
    const context = window['SillyTavern']?.getContext?.() || {};
    const evtSource = context.eventSource || window['eventSource'];
    const evtTypes = context.event_types || window['event_types'];

    if (evtSource && evtTypes) {
        evtSource.on(evtTypes.GENERATION_STARTED, () => {
            lastBalanceBeforeGen = settings.lastKnownBalance;
            preGenTimestamp = Date.now();
        });

        const onGenComplete = () => {
            if (!settings.autoRefreshOnGen) return;
            setTimeout(() => {
                fetchBalance({ silent: true, isPostGen: true });
            }, 1500);
        };

        if (evtTypes.CHARACTER_MESSAGE_RENDERED) {
            evtSource.on(evtTypes.CHARACTER_MESSAGE_RENDERED, onGenComplete);
        }
        if (evtTypes.GENERATION_ENDED) {
            evtSource.on(evtTypes.GENERATION_ENDED, onGenComplete);
        }
    }

    setTimeout(() => {
        fetchBalance({ silent: true });
    }, 2500);
});
