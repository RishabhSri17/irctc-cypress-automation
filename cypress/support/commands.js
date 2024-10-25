import {
    formatDate,
    hasTatkalAlreadyOpened,
    tatkalOpenTimeForToday,
} from "../utils";

const MANUAL_CAPTCHA = Cypress.env("MANUAL_CAPTCHA");

Cypress.on("uncaught:exception", (err, runnable) => {
    cy.task("log", `Uncaught exception: ${err.message}`);
    return false;
});

Cypress.Commands.add("submitCaptcha", () => {
    cy.task("log", "Starting submitCaptcha command");
    let LOGGED_IN = false;
    performLogin(LOGGED_IN);
});

Cypress.Commands.add("solveCaptcha", () => {
    cy.task("log", "Starting solveCaptcha command");
    solveCaptcha();
});

Cypress.Commands.add(
    "bookUntilTatkalGetsOpen",
    (div, TRAIN_COACH, TRAVEL_DATE, TRAIN_NO, TATKAL) => {
        cy.task("log", `Starting booking attempt for Train ${TRAIN_NO}, Coach ${TRAIN_COACH}`);
        cy.task("log", `Travel Date: ${TRAVEL_DATE}, Tatkal: ${TATKAL}`);
        BOOK_UNTIL_TATKAL_OPENS(
            div,
            TRAIN_COACH,
            TRAVEL_DATE,
            TRAIN_NO,
            TATKAL
        );
    }
);

function performLogin(LOGGED_IN) {
    cy.task("log", `Attempting login. Current status: ${LOGGED_IN}`);
    
    if (!LOGGED_IN) {
        cy.wait(500);

        cy.get("body")
            .should("be.visible")
            .then((el) => {
                const bodyText = el[0].innerText;
                cy.task("log", `Current page state: ${bodyText.substring(0, 100)}...`);

                if (bodyText.includes("Logout")) {
                    cy.task("log", "Login successful - Logout button found");
                } else if (
                    bodyText.includes("FORGOT ACCOUNT DETAILS") &&
                    !bodyText.includes("Please Wait...")
                ) {
                    cy.task("log", "On login page, attempting captcha");
                    
                    if (MANUAL_CAPTCHA) {
                        cy.task("log", "Manual captcha mode enabled");
                        cy.get("#captcha").focus();
                        cy.get(".search_btn.loginText")
                            .should("include.text", "Logout")
                            .then(() => {
                                cy.task("log", "Manual login successful");
                                performLogin(true);
                            });
                    } else {
                        cy.task("log", "Attempting automatic captcha solve");
                        cy.get(".captcha-img")
                            .invoke("attr", "src")
                            .then((value) => {
                                cy.task("log", "Sending captcha to solver");
                                cy.exec(
                                    `python3 irctc-captcha-solver/app.py "${value}"`
                                ).then((result) => {
                                    cy.task("log", `Captcha solver returned: ${result.stdout}`);
                                    cy.get("#captcha")
                                        .clear()
                                        .type(result.stdout)
                                        .type("{enter}");

                                    cy.get("body").then((el) => {
                                        const responseText = el[0].innerText;
                                        if (responseText.includes("Invalid Captcha")) {
                                            cy.task("log", "Invalid captcha detected, retrying");
                                            performLogin(false);
                                        } else if (responseText.includes("Logout")) {
                                            cy.task("log", "Automatic login successful");
                                            performLogin(true);
                                        } else {
                                            cy.task("log", "Login failed, retrying");
                                            performLogin(false);
                                        }
                                    });
                                });
                            });
                    }
                } else {
                    cy.task("log", "Page not in expected state, retrying login");
                    performLogin(false);
                }
            });
    }
}

let MAX_ATTEMPT = 120;

function solveCaptcha() {
    MAX_ATTEMPT -= 1;
    cy.task("log", `Captcha solve attempt ${120 - MAX_ATTEMPT} of 120`);
    
    cy.wrap(MAX_ATTEMPT, { timeout: 10000 }).should("be.gt", 0);

    cy.wait(500);
    cy.get("body")
        .should("be.visible")
        .then((el) => {
            const bodyText = el[0].innerText;
            
            if (bodyText.includes("Unable to process current transaction") && 
                bodyText.includes("Payment Mode")) {
                cy.task("log", "Transaction error detected, retrying search");
                cy.get(".train_Search").click();
                cy.wait(1000);
            }

            if (bodyText.includes("Sorry!!! Please Try again!!")) {
                cy.task("log", "IRCTC error detected");
                throw new Error("Sorry!!! Please Try again!! <<< Thrown By IRCTC");
            }

            if (bodyText.includes("Payment Methods")) {
                cy.task("log", "Captcha solved successfully");
                return;
            }

            if (bodyText.includes("No seats available")) {
                cy.task("log", "No seats available - stopping execution");
                cy.fail("Further execution stopped because there are no more tickets.");
            }

            if (bodyText.includes("Your ticket will be sent to") &&
                !bodyText.includes("Please Wait...") &&
                el[0].innerHTML.includes("Enter Captcha")) {
                
                if (MANUAL_CAPTCHA) {
                    cy.task("log", "Waiting for manual captcha entry");
                    cy.get("#captcha").focus();
                    cy.get("body").then((el) => {
                        if (el[0].innerText.includes("Payment Methods")) {
                            cy.task("log", "Manual captcha solved successfully");
                        }
                    });
                } else {
                    cy.task("log", "Attempting automatic captcha solve");
                    cy.get(".captcha-img")
                        .invoke("attr", "src")
                        .then((value) => {
                            cy.exec(
                                `python3 irctc-captcha-solver/app.py "${value}"`
                            ).then((result) => {
                                cy.task("log", `Captcha solver returned: ${result.stdout}`);
                                cy.get("#captcha")
                                    .clear()
                                    .type(result.stdout)
                                    .type("{enter}");
                                cy.get("body").then((el) => {
                                    if (el[0].innerText.includes("Payment Methods")) {
                                        cy.task("log", "Automatic captcha solved successfully");
                                    } else {
                                        cy.task("log", "Captcha solve failed, retrying");
                                        solveCaptcha();
                                    }
                                });
                            });
                        });
                    solveCaptcha();
                }
            } else if (bodyText.includes("Payment Methods")) {
                cy.task("log", "Payment page reached");
                return;
            } else {
                cy.task("log", "Page not in expected state, retrying captcha");
                solveCaptcha();
            }
        });
}

function BOOK_UNTIL_TATKAL_OPENS(
    div,
    TRAIN_COACH,
    TRAVEL_DATE,
    TRAIN_NO,
    TATKAL
) {
    cy.task("log", `Checking Tatkal booking status for train ${TRAIN_NO}`);
    cy.wait(1900);

    if (TATKAL && !hasTatkalAlreadyOpened(TRAIN_COACH)) {
        const exactTimeToOpen = tatkalOpenTimeForToday(TRAIN_COACH);
        cy.task("log", `Waiting for Tatkal opening time: ${exactTimeToOpen}`);
        cy.get("div.h_head1", { timeout: 300000 }).should(
            "include.text",
            exactTimeToOpen
        );
    }

    cy.get("body")
        .should("be.visible")
        .then((el) => {
            const bodyText = el[0].innerText;
            cy.task("log", `Current page state: ${bodyText.substring(0, 100)}...`);

            if (bodyText.includes("Booking not yet started") &&
                !bodyText.includes("Please Wait...")) {
                cy.task("log", "Booking not started, retrying search");
                cy.get(".level_1.hidden-xs > app-modify-search > .layer_2 > form.ng-untouched > .col-md-2 > .hidden-xs")
                    .click();

                cy.get("body")
                    .should("be.visible")
                    .then((el) => {
                        if (el[0].innerText.includes("Booking not yet started") &&
                            !el[0].innerText.includes("Please Wait...")) {
                            cy.task("log", "Searching for matching train");
                            cy.get(":nth-child(n) > .bull-back")
                                .should("be.visible")
                                .each((div, index) => {
                                    if (div[0].innerText.includes(TRAIN_NO) &&
                                        div[0].innerText.includes(TRAIN_COACH)) {
                                        cy.task("log", `Found matching train at index ${index}`);
                                        cy.wrap(div)
                                            .contains(TRAIN_COACH)
                                            .click();
                                        cy.get(`:nth-child(n) > .bull-back > app-train-avl-enq > :nth-child(1) > :nth-child(7) > :nth-child(1)`)
                                            .contains(formatDate(TRAVEL_DATE))
                                            .click();
                                        cy.task("log", "Clicking Book Now");
                                        cy.get(`:nth-child(n) > .bull-back > app-train-avl-enq > [style="padding-top: 10px; padding-bottom: 20px;"]`)
                                            .contains("Book Now")
                                            .click();
                                        BOOK_UNTIL_TATKAL_OPENS(
                                            div,
                                            TRAIN_COACH,
                                            TRAVEL_DATE,
                                            TRAIN_NO,
                                            TATKAL
                                        );
                                    }
                                });
                        } else {
                            cy.task("log", "Page state changed, retrying booking process");
                            BOOK_UNTIL_TATKAL_OPENS(
                                div,
                                TRAIN_COACH,
                                TRAVEL_DATE,
                                TRAIN_NO,
                                TATKAL
                            );
                        }
                    });
            } else if (bodyText.includes("Passenger Details") &&
                      bodyText.includes("Contact Details") &&
                      !bodyText.includes("Please Wait...")) {
                cy.task("log", "Successfully reached passenger details page");
            } else if (!bodyText.includes("Passenger Details") &&
                      !bodyText.includes("Contact Details") &&
                      !bodyText.includes("Please Wait...")) {
                cy.task("log", "Searching for train to book");
                cy.get("body").then((el) => {
                    cy.get(":nth-child(n) > .bull-back").each((div, index) => {
                        if (div[0].innerText.includes(TRAIN_NO) &&
                            div[0].innerText.includes(TRAIN_COACH)) {
                            cy.task("log", `Found matching train at index ${index}`);
                            cy.wrap(div).contains(TRAIN_COACH).click();
                            cy.get(`:nth-child(n) > .bull-back > app-train-avl-enq > :nth-child(1) > :nth-child(7) > :nth-child(1)`)
                                .contains(formatDate(TRAVEL_DATE))
                                .click();
                            cy.task("log", "Checking for booking options");
                            cy.get(`:nth-child(n) > .bull-back > app-train-avl-enq > [style="padding-top: 10px; padding-bottom: 20px;"]`)
                                .then((elements) => {
                                    elements.each((i, el) => {
                                        if (el.innerText.includes("₹")) {
                                            cy.task("log", `Found bookable option in div ${i + 1}`);
                                            cy.wrap(el).contains("Book Now").click();
                                        }
                                    });
                                });
                            BOOK_UNTIL_TATKAL_OPENS(
                                div,
                                TRAIN_COACH,
                                TRAVEL_DATE,
                                TRAIN_NO,
                                TATKAL
                            );
                        }
                    });
                });
            } else {
                cy.task("log", "Page in transition, retrying booking process");
                BOOK_UNTIL_TATKAL_OPENS(
                    div,
                    TRAIN_COACH,
                    TRAVEL_DATE,
                    TRAIN_NO,
                    TATKAL
                );
            }
        });
}
