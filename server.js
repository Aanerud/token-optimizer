const express = require('express');
const yaml = require('js-yaml');
const xml2js = require('xml2js');
const { encoding_for_model } = require('tiktoken');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Token counter using tiktoken for GPT-4/4.1/5.0
let encoder;
try {
    encoder = encoding_for_model('gpt-4'); // Compatible with GPT-4, 4.1, 5.0
} catch (error) {
    console.error('Failed to initialize tokenizer:', error);
}

function countTokens(text) {
    try {
        if (encoder) {
            const tokens = encoder.encode(text);
            return tokens.length;
        }
        // Fallback: rough estimate (1 token ≈ 4 characters)
        return Math.ceil(text.length / 4);
    } catch (error) {
        return Math.ceil(text.length / 4);
    }
}

// Optimization functions
function removeNullsAndEmpty(obj) {
    if (Array.isArray(obj)) {
        return obj.map(removeNullsAndEmpty).filter(v => v !== null && v !== undefined);
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined && value !== '' &&
                !(Array.isArray(value) && value.length === 0) &&
                !(typeof value === 'object' && Object.keys(value).length === 0)) {
                result[key] = removeNullsAndEmpty(value);
            }
        }
        return result;
    }
    return obj;
}

// Predefined optimal key mappings for common terms
const COMMON_KEY_MAPPINGS = {
    // Common GPT/Copilot fields
    'LicenseValidator': 'lv',
    'LicenseType': 'lt',
    'CopilotUnlimited': 'cu',
    'ModelName': 'mn',
    'SubTag': 'st',
    'LoopCount': 'lc',
    'RaiPolicyId': 'rpi',
    'llmLicenseType': 'llt',
    'feature': 'ft',
    // Message/conversation fields
    'role': 'r',
    'content': 'c',
    'system': 'sys',
    'user': 'u',
    'assistant': 'a',
    'developer': 'dev',
    'tool_calls': 'tc',
    'function': 'fn',
    'arguments': 'arg',
    'name': 'n',
    'type': 't',
    'reference_id': 'rid',
    'snippet': 'snp',
    'subject': 'sbj',
    'from': 'f',
    'to': 't',
    'participants': 'p',
    // Common data fields
    'Name': 'n',
    'Address': 'a',
    'Email': 'e',
    'subject': 's',
    'message': 'm',
    'timestamp': 'ts',
    'dateTimeReceived': 'dtr',
    'dateTimeSent': 'dts',
    'isRead': 'rd'
};

function shortenKeys(obj, keyMap = {}) {
    // Initialize with common mappings
    if (Object.keys(keyMap).length === 0) {
        Object.assign(keyMap, COMMON_KEY_MAPPINGS);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => shortenKeys(item, keyMap));
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            // Generate short key if not in map
            if (!keyMap[key]) {
                // Strategy: remove vowels, take first 2-3 consonants
                let short = key.replace(/[aeiou]/gi, '').substring(0, 3).toLowerCase();

                // If no consonants, use first 2 letters
                if (!short || short.length === 0) {
                    short = key.substring(0, 2).toLowerCase();
                }

                // Handle collisions by appending numbers
                let candidate = short;
                let counter = 1;
                while (Object.values(keyMap).includes(candidate)) {
                    candidate = short + counter;
                    counter++;
                }

                keyMap[key] = candidate;
            }
            result[keyMap[key]] = shortenKeys(value, keyMap);
        }
        return result;
    }
    return obj;
}

// Detect if input is XML
function isXML(str) {
    const trimmed = str.trim();
    return trimmed.startsWith('<') && trimmed.includes('>');
}

// Parse XML to JavaScript object
async function parseXML(xmlString) {
    const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
    });
    return await parser.parseStringPromise(xmlString);
}

app.post('/convert', async (req, res) => {
    try {
        const { input } = req.body;

        if (!input) {
            return res.status(400).json({ error: 'No input provided' });
        }

        let data;
        let inputType;

        // Try to detect and parse input format
        if (isXML(input)) {
            inputType = 'XML';
            data = await parseXML(input);
        } else {
            inputType = 'JSON';
            try {
                data = JSON.parse(input);
            } catch (e) {
                return res.status(400).json({
                    error: 'Invalid JSON or XML format. Please check your input.'
                });
            }
        }

        // Original metrics
        const originalChars = input.length;
        const originalTokens = countTokens(input);

        // Level 1: Remove nulls/empty (keep original format)
        const dataNoNulls = removeNullsAndEmpty(data);
        const jsonNoNulls = JSON.stringify(dataNoNulls);
        const jsonNoNullsTokens = countTokens(jsonNoNulls);

        // Level 2: Convert to YAML with minimal spacing
        const yamlBasic = yaml.dump(dataNoNulls, {
            indent: 1,
            lineWidth: -1,
            noRefs: true,
            flowLevel: 0,
            condenseFlow: true
        });
        const yamlBasicTokens = countTokens(yamlBasic);

        // Level 3: YAML with comments for Chain-of-Thought
        const yamlWithComments = `# Data Structure: ${inputType} optimized for LLM processing\n` +
            `# Better token distribution via BPE (Byte Pair Encoding)\n` +
            `# Use comments for reasoning while keeping output parseable\n` +
            yamlBasic;
        const yamlWithCommentsTokens = countTokens(yamlWithComments);

        // Level 4: Short keys + YAML
        const keyMap = {};
        const dataShortKeys = shortenKeys(dataNoNulls, keyMap);
        const yamlShortKeys = yaml.dump(dataShortKeys, {
            indent: 1,
            lineWidth: -1,
            noRefs: true,
            flowLevel: 0,
            condenseFlow: true
        });
        const yamlShortKeysTokens = countTokens(yamlShortKeys);

        res.json({
            inputType,
            original: {
                content: input,
                chars: originalChars,
                tokens: originalTokens
            },
            optimizations: [
                {
                    level: 'Remove Nulls/Empty',
                    description: 'Remove null, empty strings, empty arrays/objects (keeps JSON format)',
                    content: jsonNoNulls,
                    chars: jsonNoNulls.length,
                    tokens: jsonNoNullsTokens,
                    charsSaved: originalChars - jsonNoNulls.length,
                    tokensSaved: originalTokens - jsonNoNullsTokens,
                    charsPercent: ((originalChars - jsonNoNulls.length) / originalChars * 100).toFixed(1),
                    tokensPercent: ((originalTokens - jsonNoNullsTokens) / originalTokens * 100).toFixed(1)
                },
                {
                    level: 'Convert to YAML',
                    description: 'YAML format with minimal spacing + better BPE tokenization',
                    content: yamlBasic,
                    chars: yamlBasic.length,
                    tokens: yamlBasicTokens,
                    charsSaved: originalChars - yamlBasic.length,
                    tokensSaved: originalTokens - yamlBasicTokens,
                    charsPercent: ((originalChars - yamlBasic.length) / originalChars * 100).toFixed(1),
                    tokensPercent: ((originalTokens - yamlBasicTokens) / originalTokens * 100).toFixed(1)
                },
                {
                    level: 'Chain-of-Thought (Comments)',
                    description: 'YAML with # comments for LLM reasoning',
                    content: yamlWithComments,
                    chars: yamlWithComments.length,
                    tokens: yamlWithCommentsTokens,
                    charsSaved: originalChars - yamlWithComments.length,
                    tokensSaved: originalTokens - yamlWithCommentsTokens,
                    charsPercent: ((originalChars - yamlWithComments.length) / originalChars * 100).toFixed(1),
                    tokensPercent: ((originalTokens - yamlWithCommentsTokens) / originalTokens * 100).toFixed(1)
                },
                {
                    level: 'Short Keys (Aggressive)',
                    description: 'Shorten all keys + YAML',
                    content: yamlShortKeys,
                    chars: yamlShortKeys.length,
                    tokens: yamlShortKeysTokens,
                    charsSaved: originalChars - yamlShortKeys.length,
                    tokensSaved: originalTokens - yamlShortKeysTokens,
                    charsPercent: ((originalChars - yamlShortKeys.length) / originalChars * 100).toFixed(1),
                    tokensPercent: ((originalTokens - yamlShortKeysTokens) / originalTokens * 100).toFixed(1),
                    keyMap: keyMap
                }
            ]
        });

    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({
            error: 'Conversion failed: ' + error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 JSON/XML to YAML Converter running!`);
    console.log(`📊 Open http://localhost:${PORT} in your browser\n`);
});
