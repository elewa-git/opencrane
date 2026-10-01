BEGIN;

SELECT pg_temp.seed_direct_conversation('pdf-payload-conversation', 'pdf-payload-silo');

-- Empty ciphertext still needs the complete authentication envelope and exact conversation owner.
INSERT INTO conversation_private_payloads
    (id, silo_id, conversation_id, author_subject, idempotency_key, key_id, nonce, auth_tag, ciphertext, ciphertext_digest)
VALUES
    ('pdf-empty-payload', 'pdf-payload-silo', 'pdf-payload-conversation', 'pdf-participant', 'pdf-message', 'test-key',
     decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('', 'hex'),
     'sha256:' || encode(sha256(decode('', 'hex')), 'hex'));

SELECT pg_temp.assert_true('attachment-only payload keeps its retry row',
    (SELECT octet_length(ciphertext) = 0 FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'));

SELECT pg_temp.expect_failure('empty payload still requires an authentication tag',
    $test$INSERT INTO conversation_private_payloads
        SELECT 'pdf-missing-tag', silo_id, conversation_id, author_subject, 'missing-tag', key_id, nonce,
               decode('', 'hex'), ciphertext, ciphertext_digest, created_at
        FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'$test$,
    'conversation_private_payloads_encryption_check');

SELECT pg_temp.expect_failure('empty payload still requires a full nonce',
    $test$INSERT INTO conversation_private_payloads
        SELECT 'pdf-missing-nonce', silo_id, conversation_id, author_subject, 'missing-nonce', key_id,
               decode('', 'hex'), auth_tag, ciphertext, ciphertext_digest, created_at
        FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'$test$,
    'conversation_private_payloads_encryption_check');

SELECT pg_temp.expect_failure('payload upper byte bound remains enforced',
    $test$INSERT INTO conversation_private_payloads
        SELECT 'pdf-oversized', silo_id, conversation_id, author_subject, 'oversized', key_id, nonce,
               auth_tag, decode(repeat('00', 65537), 'hex'), ciphertext_digest, created_at
        FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'$test$,
    'conversation_private_payloads_encryption_check');

SELECT pg_temp.expect_failure('empty payload cannot move to another silo',
    $test$INSERT INTO conversation_private_payloads
        SELECT 'pdf-foreign', 'foreign-silo', conversation_id, author_subject, 'foreign', key_id, nonce,
               auth_tag, ciphertext, ciphertext_digest, created_at
        FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'$test$,
    'conversation_private_payloads_conversation_id_silo_id_fkey');

SELECT pg_temp.expect_failure('empty payload retry identity remains unique',
    $test$INSERT INTO conversation_private_payloads
        SELECT 'pdf-duplicate', silo_id, conversation_id, author_subject, idempotency_key, key_id, nonce,
               auth_tag, ciphertext, ciphertext_digest, created_at
        FROM conversation_private_payloads WHERE id = 'pdf-empty-payload'$test$,
    'conversation_private_payloads_conversation_id_author_subjec_key');

SELECT pg_temp.expect_failure('empty payload cannot be rewritten after admission',
    $test$UPDATE conversation_private_payloads SET ciphertext = decode('00', 'hex') WHERE id = 'pdf-empty-payload'$test$,
    'ConversationPrivatePayload rows are immutable');

ROLLBACK;
