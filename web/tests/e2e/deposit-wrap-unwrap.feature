Feature: Assets converter and stream creation
  Entry: /assets three-bay converter, or CREATE STREAM for a PT deposit.
  Wrap and unwrap are 1:1 against the tracked wrap reserve. Deposit mints
  ovrfloToken and a stream, then offers a borrow handoff.

  Background:
    Given I am on the assets page
    And my wallet is connected

  @UI-ASSETS-CONVERTER
  Scenario: Happy path — wrap underlying into ovrfloToken
    When I choose the wrap direction
    And I fill the amount field with "1"
    And I click the "CONTINUE" button
    And I acknowledge risk if prompted
    And I click the button matching "^APPROVE"
    And I click the "WRAP" button
    Then I see a confirmed action receipt

  Scenario: Happy path — unwrap ovrfloToken back into underlying
    Given the wrap reserve holds "1"
    And my wallet holds ovrfloToken from a deposit of "10"
    And the frontend re-syncs with chain state
    When I choose the unwrap direction
    And I fill the amount field with "1"
    And I click the "CONTINUE" button
    And I acknowledge risk if prompted
    And I click the "UNWRAP" button
    Then I see a confirmed action receipt

  Scenario: Clamp — unwrap is refused when the wrap reserve is empty
    When I choose the unwrap direction
    Then I see text matching "UNWRAP UNAVAILABLE|WRAP RESERVE"
    And the "CONTINUE" button is disabled

  @UI-ASSETS-STREAM-SELECT-MARKET
  Scenario: Happy path — PT deposit offers a borrow handoff
    When I open stream creation
    And I select the first stream market
    And I click the "CONTINUE" button
    And I fill the amount field with "10"
    And I click the "CONTINUE" button
    And I acknowledge risk if prompted
    And I click the "APPROVE PT" button
    And I click the "APPROVE FEE" button
    And I click the "DEPOSIT" button
    Then I see a confirmed action receipt
    And I see a borrow handoff for the new stream

  Scenario: Clamp — deposit blocked by insufficient PT
    When I open stream creation
    And I select the first stream market
    And I click the "CONTINUE" button
    And I fill the amount field with a value exceeding my PT balance
    Then I see a field error
    And the "CONTINUE" button is disabled

  Scenario: Clamp — deposit cap reached is labeled, not a silent zero
    Given the deposit cap for the active market is reached
    And the frontend re-syncs with chain state
    When I open stream creation
    And I select the first stream market
    And I click the "CONTINUE" button
    Then I see text matching "DEPOSIT CAP|CAP"

  Scenario: Identity churn — disconnect on the converter
    When I disconnect my wallet
    Then I see text matching "CONNECT WALLET"

  Scenario: Interruption — reload on wrap amount does not keep a frozen receipt
    When I choose the wrap direction
    And I fill the amount field with "1"
    When I reload the page
    Then the assets converter is open
