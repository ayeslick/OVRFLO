Feature: Claim all
  Entry: CLAIM ALL on the position summary strip. Decision: none — a single
  confirm queues every claimable stream and loan-pool share. Exit: claimable
  balances drop to zero and the corresponding wallet balance increases.

  Background:
    Given I am on the markets page
    And my wallet is connected

  Scenario: Happy path — claim all queues and confirms every claimable stream
    Given my wallet holds a stream with a withdrawable balance
    And the frontend re-syncs with chain state
    When I click the "CLAIM ALL" button
    Then the "Claim all" modal is open
    When I click the "CONFIRM QUEUE" button
    Then I see the caption "ALL CLAIMS CONFIRMED"
    When I click the "DONE" button
    Then no modal is open

  Scenario: Error state — a contract revert fails the queue mid-flight
    Given my wallet holds a stream with a withdrawable balance
    And the frontend re-syncs with chain state
    When I click the "CLAIM ALL" button
    Then the "Claim all" modal is open
    And the stream has already been claimed elsewhere
    When I click the "CONFIRM QUEUE" button
    Then I see the caption "TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES"
    And the "RESUME" button is enabled

  Scenario: Cross-cutting — empty position categories render nothing, not placeholder text
    When I expand a market I hold no positions in
    Then there is no "LENDING" position group
    And there is no "BORROWING" position group
    And there is no "STREAMS" position group
