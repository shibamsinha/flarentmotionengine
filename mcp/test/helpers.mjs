/**
 * Test harness.
 *
 * Tests drive the server through a real MCP client over an in-memory transport
 * rather than calling tool handlers directly. That is the whole point: it
 * exercises the registered schemas, the SDK's own argument validation and the
 * result envelope, so a test passing means *a client* would succeed — not merely
 * that a function returned.
 */

import './env.mjs';

import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../server.mjs';

/** A connected client plus the server behind it. */
export const connect = async () => {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'flarent-tests', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

/**
 * Call a tool and return its parsed JSON body.
 *
 * Every tool answers with a JSON text block, so decoding it here keeps the
 * assertions about behaviour rather than about envelope shape.
 */
export const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((block) => block.type === 'text');
  const body = text ? JSON.parse(text.text) : {};
  return { body, result, isError: result.isError === true };
};

/** Call a tool that is expected to succeed, failing the test if it does not. */
export const ok = async (client, name, args = {}) => {
  const { body, result, isError } = await call(client, name, args);
  assert.equal(
    isError, false,
    `${name} was expected to succeed but failed: ${JSON.stringify(body.error ?? body)}`,
  );
  assert.equal(body.success, true, `${name} did not report success`);
  return { ...body, _result: result };
};

/**
 * Call a tool that is expected to fail, asserting the error code.
 *
 * Asserting the *code* rather than the message is deliberate — messages are for
 * humans and models and should be free to improve; codes are the contract.
 */
export const fails = async (client, name, args = {}, expectedCode = undefined) => {
  const { body, isError } = await call(client, name, args);
  assert.equal(isError, true, `${name} was expected to fail but succeeded`);
  assert.equal(body.success, false);
  if (expectedCode) {
    assert.equal(
      body.error.code, expectedCode,
      `${name} failed with ${body.error.code} (${body.error.message}), expected ${expectedCode}`,
    );
  }
  return body.error;
};

/**
 * An MCP-level rejection — the SDK refusing arguments before a handler runs.
 *
 * These surface as an isError result whose text is a protocol message rather
 * than the structured JSON body, so they need their own assertion.
 */
export const rejectsSchema = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} should have been rejected by its schema`);
  const text = result.content.find((block) => block.type === 'text')?.text ?? '';
  assert.match(text, /validation|invalid|required|expected/i, `unexpected rejection text: ${text}`);
  return text;
};

/** A throwaway project, with as many scenes as asked for. */
export const makeProject = async (client, overrides = {}) => {
  const body = await ok(client, 'create_project', {
    title: 'Test project',
    scenes: [
      { text: 'discipline', duration: 1 },
      { text: 'beats', duration: 0.6 },
      { text: 'motivation', duration: 1.4 },
    ],
    ...overrides,
  });
  return body.project;
};
