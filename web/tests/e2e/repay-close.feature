Feature: Repay and close a loan
  Entry: REPAY EARLY (behind ADVANCED) or CLOSE on an open loan card. Decision:
  for repay, how much to pay down early; close takes no input. Exit: the
  loan's outstanding balance drops, or the loan settles and the stream
  returns to the borrower.

  Background:
    Given I am on the markets page
    And my wallet is connected

  Scenario: Happy path — repay early reduces the outstanding balance
    Given my wallet has an open loan against a stream
    When I expand the active market
    And I open the loan's advanced panel
    And I click the "REPAY EARLY" button
    Then the "REPAY LOAN" modal is open
    And I fill the amount field with "0.5"
    And I click the "APPROVE REPAY" button
    And I click the button matching "^REPAY "
    Then I see the caption "CONFIRMED"

  Scenario: Happy path — close a loan once the stream can cover it
    Given my wallet has an open loan against a stream
    And the loan's stream has vested enough to close it
    When I expand the active market
    And I click the "CLOSE" button
    Then the "CLOSE LOAN" modal is open
    And I click the "CLOSE LOAN" button
    Then I see the caption "CONFIRMED"

  Scenario: Error state — repay blocked by insufficient ovrfloToken balance
    Given my wallet has an open loan against a stream
    When I expand the active market
    And I open the loan's advanced panel
    And I click the "REPAY EARLY" button
    Then the "REPAY LOAN" modal is open
    And my ovrfloToken balance is drained
    And I fill the amount field with "0.5"
    Then I see the caption "INSUFFICIENT BALANCE"

  Scenario: Error state — the loan disappears while the modal is open
    Given my wallet has an open loan against a stream
    When I expand the active market
    And I open the loan's advanced panel
    And I click the "REPAY EARLY" button
    Then the "REPAY LOAN" modal is open
    And the loan is fully repaid from another channel
    Then I see the caption "LOAN NOT FOUND"

  Scenario: Error state — repay reverts if the balance is drained mid-flow
    Given my wallet has an open loan against a stream
    When I expand the active market
    And I open the loan's advanced panel
    And I click the "REPAY EARLY" button
    Then the "REPAY LOAN" modal is open
    And I fill the amount field with "0.5"
    And I click the "APPROVE REPAY" button
    And my ovrfloToken balance is drained
    And I click the button matching "^REPAY "
    Then I see a mapped error message
    And the "REPAY LOAN" modal is open
