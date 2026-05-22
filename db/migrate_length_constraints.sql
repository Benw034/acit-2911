-- Apply VARCHAR length constraints to match application-layer limits.
-- Safe to run on existing data only if the app-layer truncation has already
-- been applied (server.js truncate() calls), which it has been.

ALTER TABLE decks
  ALTER COLUMN title    TYPE VARCHAR(50)  USING LEFT(title, 50),
  ALTER COLUMN category TYPE VARCHAR(20)  USING LEFT(category, 20);

ALTER TABLE cards
  ALTER COLUMN question TYPE VARCHAR(200) USING LEFT(question, 200),
  ALTER COLUMN answer   TYPE VARCHAR(200) USING LEFT(answer, 200);

ALTER TABLE card_choices
  ALTER COLUMN choice_text TYPE VARCHAR(100) USING LEFT(choice_text, 100);
