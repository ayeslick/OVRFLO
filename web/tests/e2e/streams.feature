Feature: Streams lens on the watch surface
  Enumerable discovery lists held OVRFLO Streams with no indexer. Pledge moves
  a stream from Streams to Borrowed. Detail paints the HTML ledger card.
  Full-value settlement leaves the list; partial settlement returns a residual.
  RPC interruption shows degraded streams state, never an empty lens.

  Background:
    Given I am on the watch surface
    And my wallet is connected

  @UI-WATCH-STREAMS
  Scenario: AE1 — Enumerable discovery lists deposited streams with no indexer
    Given my wallet holds two deposited streams
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then I see the two deposited streams under Streams
    And I do not see empty-lens streams copy

  @UI-WATCH-STREAMS
  Scenario: AE2 — pledge moves a stream from Streams to Borrowed
    Given a lender has posted liquidity for the active market
    And my wallet holds a tracked eligible stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then I see a stream row for the tracked stream
    When I pledge the tracked stream via borrow
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then the tracked stream row is absent from Streams
    When I select the "BORROWED" lens
    Then I see a loan row for the tracked stream
    And the tracked stream is not double-listed

  @UI-WATCH-STREAMS
  Scenario: AE3 — detail view renders the HTML ledger card
    Given my wallet holds a tracked eligible stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    And I select the first stream row
    Then the stream detail is open
    And I see the HTML ledger card

  @UI-WATCH-STREAMS
  Scenario: AE6 — full-value settle leaves the Streams list
    Given a full-value loan has settled and disposed its stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then the disposed full-value stream is absent from Streams

  @UI-WATCH-STREAMS
  Scenario: AE6 — partial settle returns the stream to Streams
    Given a partial loan has settled and returned its stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then the returned residual stream is present under Streams

  @UI-WATCH-STREAMS
  Scenario: RPC interruption renders degraded streams state, not an empty lens
    Given my wallet holds a tracked eligible stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    And stream lockup RPC reads are interrupted
    Then I see the degraded streams state
    And I do not see empty-lens streams copy
