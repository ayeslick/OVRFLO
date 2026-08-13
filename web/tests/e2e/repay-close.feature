Feature: Repay and close from the watch surface
  Entry: borrowed detail on the watch wall. Decision: repay amount or close
  from stream, in place. Exit: outstanding drops, or the loan settles and the
  stream returns under the Streams lens.

  Background:
    Given I am on the watch surface
    And my wallet is connected

  @UI-WATCH-BORROWED-DETAIL
  Scenario: Happy path — repay early from borrowed detail
    Given my wallet has an open loan against a stream
    And the frontend re-syncs with chain state
    When I select the "BORROWED" lens
    And I select the first loan row
    Then the borrowed detail is open
    When I start the in-place "REPAY" write
    And I fill the amount field with "0.5"
    And I acknowledge risk if prompted
    And I confirm the watch write
    Then I see a confirmed action receipt

  Scenario: Happy path — close once the stream covers the outstanding
    Given my wallet has an open loan against a stream
    And the loan's stream has vested enough to close it
    When I select the "BORROWED" lens
    And I select the first loan row
    Then the borrowed detail is close-ready
    When I start the in-place "CLOSE FROM STREAM" write
    And I acknowledge risk if prompted
    And I confirm the watch write
    Then I see a confirmed action receipt

  Scenario: Clamp — repay blocked by insufficient ovrfloToken
    Given my wallet has an open loan against a stream
    And the frontend re-syncs with chain state
    When I select the "BORROWED" lens
    And I select the first loan row
    And I start the in-place "REPAY" write
    And my ovrfloToken balance is drained
    And I fill the amount field with "0.5"
    Then I see a field error

  Scenario: Outcomes — the loan disappears while repay is open
    Given my wallet has an open loan against a stream
    And the frontend re-syncs with chain state
    When I select the "BORROWED" lens
    And I select the first loan row
    And I start the in-place "REPAY" write
    And the loan is fully repaid from another channel
    And the frontend re-syncs with chain state
    Then I see a settled loan detail

  Scenario: Outcomes — repay reverts if the balance is drained mid-flow
    Given my wallet has an open loan against a stream
    And the frontend re-syncs with chain state
    When I select the "BORROWED" lens
    And I select the first loan row
    And I start the in-place "REPAY" write
    And I fill the amount field with "0.5"
    And I acknowledge risk if prompted
    And my ovrfloToken balance is drained
    And I confirm the watch write
    Then I see a mapped error message

  Scenario: Interruption — Back leaves the write without broadcasting
    Given my wallet has an open loan against a stream
    And the frontend re-syncs with chain state
    When I select the "BORROWED" lens
    And I select the first loan row
    And I start the in-place "REPAY" write
    And I click the "BACK" button
    Then the borrowed detail is open
    And the watch write is closed
