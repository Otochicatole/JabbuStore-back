-- Restore the unique email constraint after reverting duplicate email support.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
